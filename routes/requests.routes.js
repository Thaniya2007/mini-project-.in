const express = require('express');
const router = express.Router();
const upload = require('../utils/uploader');
const { saveUploadedFile } = require('../db/database');
const {
  CollectionRequest,
  WasteRecord,
  CollectionHistory,
  GpsLocation,
  User,
  getNextId
} = require('../db/models');
const { enrichRequests } = require('../db/helpers');
const { authenticateToken, requireRole } = require('../middleware/auth');

const VALID_WORKFLOW_STAGES = [
  'Request Submitted',
  'Request Accepted',
  'Collector Assigned',
  'Collection in Progress',
  'Waste Collected',
  'Transported',
  'Handed Over to Authorized Treatment Facility',
  'Completed'
];

const PRIORITY_RANK = { Urgent: 1, High: 2, Normal: 3 };
const ASSIGNED_STATUS_RANK = {
  'Collection in Progress': 1,
  'Collector Assigned': 2,
  'Waste Collected': 3,
  'Transported': 4,
  'Handed Over to Authorized Treatment Facility': 5,
  'Completed': 6
};

// GET /api/requests/pending - Available requests for collectors to accept
router.get('/pending', authenticateToken, requireRole(['collector', 'admin']), async (req, res) => {
  try {
    const raw = await CollectionRequest.find({
      status: { $in: ['Request Submitted', 'Request Accepted'] }
    }).sort({ created_at: -1 }).lean();

    raw.sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority] || 3;
      const pb = PRIORITY_RANK[b.priority] || 3;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    const requests = await enrichRequests(raw);
    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/requests/assigned - Requests assigned to current collector
router.get('/assigned', authenticateToken, requireRole('collector'), async (req, res) => {
  try {
    const collectorId = req.collector ? req.collector.collector_id : null;
    if (!collectorId) {
      return res.status(400).json({ success: false, message: 'Collector profile not linked.' });
    }

    const raw = await CollectionRequest.find({ collector_id: collectorId }).lean();
    raw.sort((a, b) => {
      const sa = ASSIGNED_STATUS_RANK[a.status] || 7;
      const sb = ASSIGNED_STATUS_RANK[b.status] || 7;
      if (sa !== sb) return sa - sb;
      return new Date(b.updated_at) - new Date(a.updated_at);
    });

    const requests = await enrichRequests(raw);
    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/requests/:id/accept - Collector accepts request
router.post('/:id/accept', authenticateToken, requireRole('collector'), async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const collectorId = req.collector.collector_id;
    const { collector_lat, collector_lng } = req.body;

    const request = await CollectionRequest.findOne({ id: requestId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    if (request.status !== 'Request Submitted' && request.status !== 'Request Accepted') {
      return res.status(400).json({ success: false, message: `Request is already in status: ${request.status}` });
    }

    const lat = parseFloat(collector_lat) || req.collector.current_lat || 12.9720;
    const lng = parseFloat(collector_lng) || req.collector.current_lng || 77.5950;

    request.status = 'Collector Assigned';
    request.collector_id = collectorId;
    request.collector_lat = lat;
    request.collector_lng = lng;
    request.updated_at = new Date();
    await request.save();

    const histId = await getNextId('collection_history');
    await CollectionHistory.create({
      id: histId,
      request_id: requestId,
      status: 'Collector Assigned',
      notes: `Accepted and assigned to collector: ${req.user.full_name} (${req.collector.vehicle_number})`,
      updated_by_user_id: req.user.id,
      latitude: lat,
      longitude: lng
    });

    const gpsId = await getNextId('gps_locations');
    await GpsLocation.create({
      id: gpsId,
      request_id: requestId,
      collector_id: collectorId,
      latitude: lat,
      longitude: lng,
      accuracy: 5.0,
      location_type: 'collector_waypoint'
    });

    res.json({
      success: true,
      message: 'Request accepted successfully! You are now assigned to collect this waste.',
      status: 'Collector Assigned'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/requests/:id/reject - Collector rejects request
router.post('/:id/reject', authenticateToken, requireRole('collector'), async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const { reason } = req.body;

    const request = await CollectionRequest.findOne({ id: requestId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    request.rejection_reason = reason || 'Declined by collector';
    request.updated_at = new Date();
    await request.save();

    const histId = await getNextId('collection_history');
    await CollectionHistory.create({
      id: histId,
      request_id: requestId,
      status: request.status,
      notes: `Collection declined by collector: ${req.user.full_name}. Reason: ${reason || 'Capacity full'}`,
      updated_by_user_id: req.user.id
    });

    res.json({ success: true, message: 'Request declined. It remains open for other active collectors.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/requests/:id/status - Advance status in 8-stage lifecycle
router.post('/:id/status', authenticateToken, requireRole(['collector', 'admin']), upload.single('proof_photo'), async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const {
      status,
      actual_weight_kg,
      disposal_facility_id,
      handover_notes,
      collector_lat,
      collector_lng
    } = req.body;

    if (!status || !VALID_WORKFLOW_STAGES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${VALID_WORKFLOW_STAGES.join(', ')}`
      });
    }

    const request = await CollectionRequest.findOne({ id: requestId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Collection request not found.' });
    }

    let proofPhotoUrl = request.proof_photo;
    if (req.file) {
      proofPhotoUrl = await saveUploadedFile(req.file, 'proofs');
    }

    const lat = parseFloat(collector_lat) || request.collector_lat || 12.9720;
    const lng = parseFloat(collector_lng) || request.collector_lng || 77.5950;
    const actualWeight = actual_weight_kg ? parseFloat(actual_weight_kg) : request.actual_weight_kg;
    const facilityId = disposal_facility_id ? parseInt(disposal_facility_id) : request.disposal_facility_id;
    const notes = handover_notes || request.handover_notes || '';

    request.status = status;
    if (actualWeight !== null && actualWeight !== undefined) request.actual_weight_kg = actualWeight;
    if (proofPhotoUrl) request.proof_photo = proofPhotoUrl;
    if (facilityId) request.disposal_facility_id = facilityId;
    if (notes) request.handover_notes = notes;
    request.collector_lat = lat;
    request.collector_lng = lng;
    request.updated_at = new Date();
    await request.save();

    if (actualWeight) {
      await WasteRecord.updateMany({ request_id: requestId }, { quantity_kg: actualWeight });
    }

    const histId = await getNextId('collection_history');
    await CollectionHistory.create({
      id: histId,
      request_id: requestId,
      status,
      notes: `Status updated to "${status}". Notes: ${notes}${actualWeight ? ` (Verified Weight: ${actualWeight} kg)` : ''}`,
      updated_by_user_id: req.user.id,
      latitude: lat,
      longitude: lng
    });

    const gpsId = await getNextId('gps_locations');
    await GpsLocation.create({
      id: gpsId,
      request_id: requestId,
      collector_id: request.collector_id || (req.collector ? req.collector.collector_id : null),
      latitude: lat,
      longitude: lng,
      accuracy: 4.5,
      location_type: (status === 'Handed Over to Authorized Treatment Facility' || status === 'Completed')
        ? 'disposal_point'
        : 'collector_waypoint'
    });

    res.json({
      success: true,
      message: `Status successfully updated to "${status}"`,
      data: {
        id: requestId,
        status,
        actual_weight_kg: actualWeight,
        proof_photo: proofPhotoUrl
      }
    });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/requests/:id - Complete details of a single request
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const rawReq = await CollectionRequest.findOne({ id: requestId }).lean();
    if (!rawReq) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const [request] = await enrichRequests([rawReq]);
    const history = await CollectionHistory.find({ request_id: requestId }).sort({ created_at: 1 }).lean();

    const userIds = history.map(h => h.updated_by_user_id).filter(Boolean);
    const users = await User.find({ id: { $in: userIds } }).select('id full_name role').lean();
    const userMap = new Map(users.map(u => [u.id, u]));
    const enrichedHistory = history.map(h => {
      const u = userMap.get(h.updated_by_user_id) || {};
      return {
        ...h,
        updater_name: u.full_name || null,
        updater_role: u.role || null
      };
    });

    const gpsTrail = await GpsLocation.find({ request_id: requestId }).sort({ recorded_at: 1 }).lean();

    res.json({
      success: true,
      data: {
        request,
        history: enrichedHistory,
        gpsTrail,
        stages: VALID_WORKFLOW_STAGES
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

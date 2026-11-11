const express = require('express');
const router = express.Router();
const upload = require('../utils/uploader');
const { saveUploadedFile } = require('../db/database');
const {
  WasteCategory,
  Department,
  CollectionRequest,
  WasteRecord,
  GpsLocation,
  CollectionHistory,
  User,
  getNextId
} = require('../db/models');
const { enrichRequests } = require('../db/helpers');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/waste/categories - Public & authenticated
router.get('/categories', async (req, res) => {
  try {
    const categories = await WasteCategory.find({}).sort({ id: 1 }).lean();
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/waste/departments
router.get('/departments', async (req, res) => {
  try {
    const departments = await Department.find({}).sort({ name: 1 }).lean();
    res.json({ success: true, data: departments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/waste/request - Hospital Staff submits collection request
router.post('/request', authenticateToken, requireRole('staff'), upload.single('waste_photo'), async (req, res) => {
  try {
    const {
      department_id,
      room_number,
      category_id,
      estimated_weight_kg,
      number_of_bags,
      priority,
      collection_lat,
      collection_lng,
      collection_address,
      waste_photo_url,
      notes
    } = req.body;

    let photoUrl = waste_photo_url || null;
    if (req.file) {
      photoUrl = await saveUploadedFile(req.file, 'waste');
    }

    // Mandatory image rule: Waste must only be segregated after uploading an image
    if (!photoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Mandatory Policy: Waste should be segregated only after uploading a photograph. Please upload or capture an image of the waste first.'
      });
    }

    if (!department_id || !room_number || !category_id || !estimated_weight_kg) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: department, room number, waste category, and estimated weight (kg).'
      });
    }

    const staffId = req.staff ? req.staff.staff_id : null;
    if (!staffId) {
      return res.status(400).json({ success: false, message: 'Staff profile record not linked to this account.' });
    }

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const requestNumber = `BMW-${dateStr}-${randomSuffix}`;

    const lat = parseFloat(collection_lat) || 12.9716;
    const lng = parseFloat(collection_lng) || 77.5946;
    const now = new Date();

    const requestId = await getNextId('collection_requests');
    await CollectionRequest.create({
      id: requestId,
      request_number: requestNumber,
      staff_id: staffId,
      department_id: parseInt(department_id),
      room_number: room_number.trim(),
      category_id: parseInt(category_id),
      estimated_weight_kg: parseFloat(estimated_weight_kg),
      waste_photo: photoUrl,
      priority: priority || 'Normal',
      status: 'Request Submitted',
      collection_lat: lat,
      collection_lng: lng,
      collection_address: collection_address || 'Hospital Department Location',
      handover_notes: notes || '',
      created_at: now,
      updated_at: now
    });

    const recordId = await getNextId('waste_records');
    await WasteRecord.create({
      id: recordId,
      request_id: requestId,
      category_id: parseInt(category_id),
      quantity_kg: parseFloat(estimated_weight_kg),
      unit: 'kg',
      number_of_bags: parseInt(number_of_bags) || 1,
      photo_url: photoUrl,
      hazard_level: 'High',
      notes: notes || '',
      recorded_by_staff_id: staffId
    });

    const gpsId = await getNextId('gps_locations');
    await GpsLocation.create({
      id: gpsId,
      request_id: requestId,
      latitude: lat,
      longitude: lng,
      accuracy: 5.0,
      location_type: 'collection_point'
    });

    const histId = await getNextId('collection_history');
    await CollectionHistory.create({
      id: histId,
      request_id: requestId,
      status: 'Request Submitted',
      notes: `Request submitted by staff: ${req.user.full_name} with estimated weight ${estimated_weight_kg} kg`,
      updated_by_user_id: req.user.id,
      latitude: lat,
      longitude: lng
    });

    res.status(201).json({
      success: true,
      message: `Collection request ${requestNumber} submitted successfully!`,
      data: {
        id: requestId,
        request_number: requestNumber,
        status: 'Request Submitted',
        waste_photo: photoUrl
      }
    });
  } catch (error) {
    console.error('Submit request error:', error);
    res.status(500).json({ success: false, message: 'Failed to create request: ' + error.message });
  }
});

// GET /api/waste/my-requests - Staff's own collection requests
router.get('/my-requests', authenticateToken, requireRole('staff'), async (req, res) => {
  try {
    const staffId = req.staff ? req.staff.staff_id : null;
    if (!staffId) {
      return res.status(400).json({ success: false, message: 'Staff profile record missing.' });
    }

    const rawRequests = await CollectionRequest.find({ staff_id: staffId })
      .sort({ created_at: -1 })
      .lean();
    const requests = await enrichRequests(rawRequests);

    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/waste/request/:id/history - Timeline of 8 stages for a request
router.get('/request/:id/history', authenticateToken, async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const history = await CollectionHistory.find({ request_id: requestId })
      .sort({ created_at: 1 })
      .lean();

    const userIds = history.map(h => h.updated_by_user_id).filter(Boolean);
    const users = await User.find({ id: { $in: userIds } }).select('id full_name role').lean();
    const userMap = new Map(users.map(u => [u.id, u]));

    const enriched = history.map(h => {
      const u = userMap.get(h.updated_by_user_id) || {};
      return {
        ...h,
        updater_name: u.full_name || null,
        updater_role: u.role || null
      };
    });

    res.json({ success: true, data: enriched });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

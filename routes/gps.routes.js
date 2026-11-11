const express = require('express');
const router = express.Router();
const {
  CollectionRequest,
  Collector,
  User,
  DisposalFacility,
  GpsLocation,
  getNextId
} = require('../db/models');
const { enrichRequests } = require('../db/helpers');
const { authenticateToken, requireRole } = require('../middleware/auth');

// POST /api/gps/update-location - Collector sends live GPS telemetry
router.post('/update-location', authenticateToken, requireRole('collector'), async (req, res) => {
  try {
    const collectorId = req.collector ? req.collector.collector_id : null;
    const { latitude, longitude, accuracy, speed, request_id } = req.body;

    if (!collectorId) {
      return res.status(400).json({ success: false, message: 'Collector profile not found.' });
    }

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'Latitude and Longitude are required.' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    await Collector.updateOne(
      { id: collectorId },
      { current_lat: lat, current_lng: lng }
    );

    const gpsId = await getNextId('gps_locations');
    await GpsLocation.create({
      id: gpsId,
      request_id: request_id ? parseInt(request_id) : null,
      collector_id: collectorId,
      latitude: lat,
      longitude: lng,
      accuracy: accuracy !== undefined ? parseFloat(accuracy) : null,
      speed: speed !== undefined ? parseFloat(speed) : null,
      location_type: 'collector_waypoint'
    });

    if (request_id) {
      await CollectionRequest.updateOne(
        { id: parseInt(request_id), collector_id: collectorId },
        { collector_lat: lat, collector_lng: lng, updated_at: new Date() }
      );
    }

    res.json({ success: true, message: 'GPS location recorded successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/gps/live-map-data - For Admin and Collector map views
router.get('/live-map-data', authenticateToken, async (req, res) => {
  try {
    const rawPoints = await CollectionRequest.find({
      collection_lat: { $ne: null },
      collection_lng: { $ne: null }
    }).sort({ updated_at: -1 }).limit(50).lean();

    const collectionPoints = await enrichRequests(rawPoints);

    const activeCollectors = await Collector.find({ is_active: 1 }).lean();
    const colUserIds = activeCollectors.map(c => c.user_id);
    const users = await User.find({ id: { $in: colUserIds } }).select('id full_name phone').lean();
    const userMap = new Map(users.map(u => [u.id, u]));

    const collectors = activeCollectors.map(c => {
      const u = userMap.get(c.user_id) || {};
      return {
        ...c,
        full_name: u.full_name || null,
        phone: u.phone || null
      };
    });

    const facilities = await DisposalFacility.find({ status: 'Active' }).lean();

    res.json({
      success: true,
      data: {
        collectionPoints,
        collectors,
        facilities
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/gps/request-route/:id - Route details between collection point and disposal facility
router.get('/request-route/:id', authenticateToken, async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const rawReq = await CollectionRequest.findOne({ id: requestId }).lean();
    if (!rawReq) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const [request] = await enrichRequests([rawReq]);
    const waypoints = await GpsLocation.find({ request_id: requestId })
      .select('latitude longitude location_type recorded_at -_id')
      .sort({ recorded_at: 1 })
      .lean();

    res.json({
      success: true,
      data: {
        request,
        waypoints
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

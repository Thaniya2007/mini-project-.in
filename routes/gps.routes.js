const express = require('express');
const router = express.Router();
const { get, run, all } = require('../db/database');
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

    // Update current position in collectors table
    await run(`
      UPDATE collectors
      SET current_lat = ?, current_lng = ?
      WHERE id = ?
    `, [lat, lng, collectorId]);

    // Record waypoint
    await run(`
      INSERT INTO gps_locations (
        request_id, collector_id, latitude, longitude, accuracy, speed, location_type
      ) VALUES (?, ?, ?, ?, ?, ?, 'collector_waypoint')
    `, [request_id || null, collectorId, lat, lng, accuracy || null, speed || null]);

    // If an active request is provided, also update its collector_lat / collector_lng
    if (request_id) {
      await run(`
        UPDATE collection_requests
        SET collector_lat = ?, collector_lng = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND collector_id = ?
      `, [lat, lng, request_id, collectorId]);
    }

    res.json({ success: true, message: 'GPS location recorded successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/gps/live-map-data - For Admin and Collector map views
router.get('/live-map-data', authenticateToken, async (req, res) => {
  try {
    // 1. All active and recent collection points
    const collectionPoints = await all(`
      SELECT 
        cr.id, cr.request_number, cr.status, cr.priority,
        cr.estimated_weight_kg, cr.actual_weight_kg, cr.room_number,
        cr.collection_lat, cr.collection_lng, cr.collection_address,
        cr.collector_lat, cr.collector_lng, cr.created_at, cr.updated_at,
        c.name as category_name, c.color as category_color, c.hex_color as category_hex,
        d.name as department_name, d.code as department_code,
        u_staff.full_name as staff_name,
        u_col.full_name as collector_name, col.vehicle_number,
        fac.name as facility_name, fac.latitude as facility_lat, fac.longitude as facility_lng
      FROM collection_requests cr
      LEFT JOIN waste_categories c ON cr.category_id = c.id
      LEFT JOIN departments d ON cr.department_id = d.id
      LEFT JOIN staff stf ON cr.staff_id = stf.id
      LEFT JOIN users u_staff ON stf.user_id = u_staff.id
      LEFT JOIN collectors col ON cr.collector_id = col.id
      LEFT JOIN users u_col ON col.user_id = u_col.id
      LEFT JOIN disposal_facilities fac ON cr.disposal_facility_id = fac.id
      WHERE cr.collection_lat IS NOT NULL AND cr.collection_lng IS NOT NULL
      ORDER BY cr.updated_at DESC
      LIMIT 50
    `);

    // 2. Active collectors with their latest locations
    const collectors = await all(`
      SELECT 
        col.id, col.collector_code, col.vehicle_number, col.vehicle_type,
        col.assigned_zone, col.current_lat, col.current_lng, col.is_active,
        u.full_name, u.phone
      FROM collectors col
      JOIN users u ON col.user_id = u.id
      WHERE col.is_active = 1
    `);

    // 3. Authorized disposal facilities
    const facilities = await all(`
      SELECT * FROM disposal_facilities WHERE status = 'Active'
    `);

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
    const request = await get(`
      SELECT 
        cr.id, cr.request_number, cr.status,
        cr.collection_lat, cr.collection_lng, cr.collection_address,
        cr.collector_lat, cr.collector_lng,
        col.vehicle_number, col.current_lat, col.current_lng,
        fac.name as facility_name, fac.address as facility_address,
        fac.latitude as facility_lat, fac.longitude as facility_lng,
        c.name as category_name, c.color as category_color, c.hex_color as category_hex
      FROM collection_requests cr
      LEFT JOIN waste_categories c ON cr.category_id = c.id
      LEFT JOIN collectors col ON cr.collector_id = col.id
      LEFT JOIN disposal_facilities fac ON cr.disposal_facility_id = fac.id
      WHERE cr.id = ?
    `, [req.params.id]);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const waypoints = await all(`
      SELECT latitude, longitude, location_type, recorded_at
      FROM gps_locations
      WHERE request_id = ?
      ORDER BY recorded_at ASC
    `, [req.params.id]);

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


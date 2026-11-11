const express = require('express');
const router = express.Router();
const upload = require('../utils/uploader');
const { get, run, all } = require('../db/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/waste/categories - Public & authenticated
router.get('/categories', async (req, res) => {
  try {
    const categories = await all('SELECT * FROM waste_categories ORDER BY id ASC');
    res.json({ success: true, data: categories });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/waste/departments
router.get('/departments', async (req, res) => {
  try {
    const departments = await all('SELECT * FROM departments ORDER BY name ASC');
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

    const photoUrl = req.file ? `/uploads/waste/${req.file.filename}` : (waste_photo_url || null);

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

    // Generate unique BMW request tracking code
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const requestNumber = `BMW-${dateStr}-${randomSuffix}`;

    const lat = parseFloat(collection_lat) || 12.9716;
    const lng = parseFloat(collection_lng) || 77.5946;

    // Insert collection request with status 1: "Request Submitted"
    const result = await run(`
      INSERT INTO collection_requests (
        request_number, staff_id, department_id, room_number, category_id,
        estimated_weight_kg, waste_photo, priority, status,
        collection_lat, collection_lng, collection_address, handover_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Request Submitted', ?, ?, ?, ?)
    `, [
      requestNumber,
      staffId,
      parseInt(department_id),
      room_number.trim(),
      parseInt(category_id),
      parseFloat(estimated_weight_kg),
      photoUrl,
      priority || 'Normal',
      lat,
      lng,
      collection_address || 'Hospital Department Location',
      notes || ''
    ]);

    const requestId = result.id;

    // Insert into waste_records
    await run(`
      INSERT INTO waste_records (
        request_id, category_id, quantity_kg, unit, number_of_bags,
        photo_url, hazard_level, notes, recorded_by_staff_id
      ) VALUES (?, ?, ?, 'kg', ?, ?, 'High', ?, ?)
    `, [
      requestId,
      parseInt(category_id),
      parseFloat(estimated_weight_kg),
      parseInt(number_of_bags) || 1,
      photoUrl,
      notes || '',
      staffId
    ]);

    // Record initial GPS location waypoint
    await run(`
      INSERT INTO gps_locations (
        request_id, latitude, longitude, accuracy, location_type
      ) VALUES (?, ?, ?, 5.0, 'collection_point')
    `, [requestId, lat, lng]);

    // Record in collection_history
    await run(`
      INSERT INTO collection_history (
        request_id, status, notes, updated_by_user_id, latitude, longitude
      ) VALUES (?, 'Request Submitted', ?, ?, ?, ?)
    `, [requestId, `Request submitted by staff: ${req.user.full_name} with estimated weight ${estimated_weight_kg} kg`, req.user.id, lat, lng]);

    res.status(201).json({
      success: true,
      message: `Collection request ${requestNumber} submitted successfully!`,
      data: {
        id: requestId,
        request_number: requestNumber,
        status: 'Request Submitted'
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

    const requests = await all(`
      SELECT 
        cr.*,
        c.name as category_name, c.color as category_color, c.hex_color as category_hex, c.badge_class,
        d.name as department_name, d.code as department_code,
        col.collector_code, col.vehicle_number, u.full_name as collector_name, u.phone as collector_phone,
        fac.name as facility_name
      FROM collection_requests cr
      LEFT JOIN waste_categories c ON cr.category_id = c.id
      LEFT JOIN departments d ON cr.department_id = d.id
      LEFT JOIN collectors col ON cr.collector_id = col.id
      LEFT JOIN users u ON col.user_id = u.id
      LEFT JOIN disposal_facilities fac ON cr.disposal_facility_id = fac.id
      WHERE cr.staff_id = ?
      ORDER BY cr.created_at DESC
    `, [staffId]);

    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/waste/request/:id/history - Timeline of 8 stages for a request
router.get('/request/:id/history', authenticateToken, async (req, res) => {
  try {
    const history = await all(`
      SELECT ch.*, u.full_name as updater_name, u.role as updater_role
      FROM collection_history ch
      LEFT JOIN users u ON ch.updated_by_user_id = u.id
      WHERE ch.request_id = ?
      ORDER BY ch.created_at ASC
    `, [req.params.id]);

    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;


const express = require('express');
const router = express.Router();
const upload = require('../utils/uploader');
const { get, run, all } = require('../db/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// The 8 official stages in order
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

// GET /api/requests/pending - Available requests for collectors to accept
router.get('/pending', authenticateToken, requireRole(['collector', 'admin']), async (req, res) => {
  try {
    const requests = await all(`
      SELECT 
        cr.*,
        c.name as category_name, c.color as category_color, c.hex_color as category_hex, c.badge_class,
        d.name as department_name, d.code as department_code, d.floor, d.building,
        u_staff.full_name as staff_name, u_staff.phone as staff_phone,
        stf.staff_code, stf.designation as staff_designation
      FROM collection_requests cr
      LEFT JOIN waste_categories c ON cr.category_id = c.id
      LEFT JOIN departments d ON cr.department_id = d.id
      LEFT JOIN staff stf ON cr.staff_id = stf.id
      LEFT JOIN users u_staff ON stf.user_id = u_staff.id
      WHERE cr.status IN ('Request Submitted', 'Request Accepted')
      ORDER BY 
        CASE cr.priority 
          WHEN 'Urgent' THEN 1 
          WHEN 'High' THEN 2 
          ELSE 3 
        END,
        cr.created_at DESC
    `);

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

    const requests = await all(`
      SELECT 
        cr.*,
        c.name as category_name, c.color as category_color, c.hex_color as category_hex, c.badge_class,
        d.name as department_name, d.code as department_code, d.floor, d.building,
        u_staff.full_name as staff_name, u_staff.phone as staff_phone,
        fac.name as facility_name, fac.address as facility_address, fac.latitude as facility_lat, fac.longitude as facility_lng
      FROM collection_requests cr
      LEFT JOIN waste_categories c ON cr.category_id = c.id
      LEFT JOIN departments d ON cr.department_id = d.id
      LEFT JOIN staff stf ON cr.staff_id = stf.id
      LEFT JOIN users u_staff ON stf.user_id = u_staff.id
      LEFT JOIN disposal_facilities fac ON cr.disposal_facility_id = fac.id
      WHERE cr.collector_id = ?
      ORDER BY 
        CASE cr.status 
          WHEN 'Collection in Progress' THEN 1
          WHEN 'Collector Assigned' THEN 2
          WHEN 'Waste Collected' THEN 3
          WHEN 'Transported' THEN 4
          WHEN 'Handed Over to Authorized Treatment Facility' THEN 5
          WHEN 'Completed' THEN 6
          ELSE 7
        END,
        cr.updated_at DESC
    `, [collectorId]);

    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/requests/:id/accept - Collector accepts request
router.post('/:id/accept', authenticateToken, requireRole('collector'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const collectorId = req.collector.collector_id;
    const { collector_lat, collector_lng } = req.body;

    const request = await get('SELECT * FROM collection_requests WHERE id = ?', [requestId]);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    if (request.status !== 'Request Submitted' && request.status !== 'Request Accepted') {
      return res.status(400).json({ success: false, message: `Request is already in status: ${request.status}` });
    }

    const lat = parseFloat(collector_lat) || req.collector.current_lat || 12.9720;
    const lng = parseFloat(collector_lng) || req.collector.current_lng || 77.5950;

    // Update status to 'Collector Assigned'
    await run(`
      UPDATE collection_requests
      SET status = 'Collector Assigned',
          collector_id = ?,
          collector_lat = ?,
          collector_lng = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [collectorId, lat, lng, requestId]);

    // Record in history
    await run(`
      INSERT INTO collection_history (request_id, status, notes, updated_by_user_id, latitude, longitude)
      VALUES (?, 'Collector Assigned', ?, ?, ?, ?)
    `, [requestId, `Accepted and assigned to collector: ${req.user.full_name} (${req.collector.vehicle_number})`, req.user.id, lat, lng]);

    // Record GPS trail
    await run(`
      INSERT INTO gps_locations (request_id, collector_id, latitude, longitude, accuracy, location_type)
      VALUES (?, ?, ?, ?, 5.0, 'collector_waypoint')
    `, [requestId, collectorId, lat, lng]);

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
    const requestId = req.params.id;
    const { reason } = req.body;

    const request = await get('SELECT * FROM collection_requests WHERE id = ?', [requestId]);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    // Keep request available for other collectors
    await run(`
      UPDATE collection_requests
      SET rejection_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reason || 'Declined by collector', requestId]);

    await run(`
      INSERT INTO collection_history (request_id, status, notes, updated_by_user_id)
      VALUES (?, ?, ?, ?)
    `, [requestId, request.status, `Collection declined by collector: ${req.user.full_name}. Reason: ${reason || 'Capacity full'}`, req.user.id]);

    res.json({ success: true, message: 'Request declined. It remains open for other active collectors.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/requests/:id/status - Advance status in 8-stage lifecycle
router.post('/:id/status', authenticateToken, requireRole(['collector', 'admin']), upload.single('proof_photo'), async (req, res) => {
  try {
    const requestId = req.params.id;
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

    const request = await get('SELECT * FROM collection_requests WHERE id = ?', [requestId]);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Collection request not found.' });
    }

    const proofPhotoUrl = req.file ? `/uploads/proofs/${req.file.filename}` : request.proof_photo;
    const lat = parseFloat(collector_lat) || request.collector_lat || 12.9720;
    const lng = parseFloat(collector_lng) || request.collector_lng || 77.5950;
    const actualWeight = actual_weight_kg ? parseFloat(actual_weight_kg) : request.actual_weight_kg;
    const facilityId = disposal_facility_id ? parseInt(disposal_facility_id) : request.disposal_facility_id;
    const notes = handover_notes || request.handover_notes || '';

    // Update request
    await run(`
      UPDATE collection_requests
      SET status = ?,
          actual_weight_kg = COALESCE(?, actual_weight_kg),
          proof_photo = COALESCE(?, proof_photo),
          disposal_facility_id = COALESCE(?, disposal_facility_id),
          handover_notes = COALESCE(?, handover_notes),
          collector_lat = ?,
          collector_lng = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, actualWeight, proofPhotoUrl, facilityId, notes, lat, lng, requestId]);

    // Also update waste_records actual weight if provided
    if (actualWeight) {
      await run(`
        UPDATE waste_records
        SET quantity_kg = ?
        WHERE request_id = ?
      `, [actualWeight, requestId]);
    }

    // Add to collection_history
    await run(`
      INSERT INTO collection_history (request_id, status, notes, updated_by_user_id, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      requestId,
      status,
      `Status updated to "${status}". Notes: ${notes}${actualWeight ? ` (Verified Weight: ${actualWeight} kg)` : ''}`,
      req.user.id,
      lat,
      lng
    ]);

    // Record GPS coordinate
    await run(`
      INSERT INTO gps_locations (request_id, collector_id, latitude, longitude, accuracy, location_type)
      VALUES (?, ?, ?, ?, 4.5, ?)
    `, [
      requestId,
      request.collector_id || (req.collector ? req.collector.collector_id : null),
      lat,
      lng,
      status === 'Handed Over to Authorized Treatment Facility' || status === 'Completed' ? 'disposal_point' : 'collector_waypoint'
    ]);

    res.json({
      success: true,
      message: `Status successfully updated to "${status}"`,
      data: {
        id: requestId,
        status: status,
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
    const request = await get(`
      SELECT 
        cr.*,
        c.name as category_name, c.color as category_color, c.hex_color as category_hex, c.badge_class, c.example_items, c.segregation_rules,
        d.name as department_name, d.code as department_code, d.floor, d.building, d.head_name as dept_head, d.contact_number as dept_contact,
        u_staff.full_name as staff_name, u_staff.phone as staff_phone, stf.staff_code, stf.designation as staff_designation,
        u_col.full_name as collector_name, u_col.phone as collector_phone, col.collector_code, col.vehicle_number, col.vehicle_type,
        fac.name as facility_name, fac.address as facility_address, fac.facility_type, fac.contact_person as facility_contact, fac.contact_phone as facility_phone,
        fac.latitude as facility_lat, fac.longitude as facility_lng, fac.license_number as facility_license
      FROM collection_requests cr
      LEFT JOIN waste_categories c ON cr.category_id = c.id
      LEFT JOIN departments d ON cr.department_id = d.id
      LEFT JOIN staff stf ON cr.staff_id = stf.id
      LEFT JOIN users u_staff ON stf.user_id = u_staff.id
      LEFT JOIN collectors col ON cr.collector_id = col.id
      LEFT JOIN users u_col ON col.user_id = u_col.id
      LEFT JOIN disposal_facilities fac ON cr.disposal_facility_id = fac.id
      WHERE cr.id = ?
    `, [req.params.id]);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const history = await all(`
      SELECT ch.*, u.full_name as updater_name, u.role as updater_role
      FROM collection_history ch
      LEFT JOIN users u ON ch.updated_by_user_id = u.id
      WHERE ch.request_id = ?
      ORDER BY ch.created_at ASC
    `, [req.params.id]);

    const gpsTrail = await all(`
      SELECT * FROM gps_locations
      WHERE request_id = ?
      ORDER BY recorded_at ASC
    `, [req.params.id]);

    res.json({
      success: true,
      data: {
        request,
        history,
        gpsTrail,
        stages: VALID_WORKFLOW_STAGES
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;


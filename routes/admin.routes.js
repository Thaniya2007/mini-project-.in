const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { get, run, all } = require('../db/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Protect all admin routes
router.use(authenticateToken);
router.use(requireRole('admin'));

// GET /api/admin/dashboard-stats - Complete summary cards and charts
router.get('/dashboard-stats', async (req, res) => {
  try {
    // 1. Total waste collected (kg)
    const weightResult = await get(`
      SELECT 
        COALESCE(SUM(COALESCE(actual_weight_kg, estimated_weight_kg)), 0) as total_waste_kg,
        COUNT(*) as total_requests
      FROM collection_requests
    `);

    // 2. Pending Requests
    const pendingResult = await get(`
      SELECT COUNT(*) as count 
      FROM collection_requests 
      WHERE status NOT IN ('Completed', 'Handed Over to Authorized Treatment Facility')
    `);

    // 3. Completed Collections
    const completedResult = await get(`
      SELECT COUNT(*) as count 
      FROM collection_requests 
      WHERE status IN ('Completed', 'Handed Over to Authorized Treatment Facility')
    `);

    // 4. Active Collectors
    const collectorsResult = await get(`
      SELECT COUNT(*) as count FROM collectors WHERE is_active = 1
    `);

    // 5. Category-wise statistics
    const categoryStats = await all(`
      SELECT 
        c.id, c.name, c.color, c.hex_color,
        COUNT(cr.id) as request_count,
        COALESCE(SUM(COALESCE(cr.actual_weight_kg, cr.estimated_weight_kg)), 0) as total_kg
      FROM waste_categories c
      LEFT JOIN collection_requests cr ON c.id = cr.category_id
      GROUP BY c.id
      ORDER BY c.id ASC
    `);

    // 6. Recent collection activities
    const recentActivities = await all(`
      SELECT 
        cr.id, cr.request_number, cr.status, cr.priority, cr.created_at, cr.updated_at,
        COALESCE(cr.actual_weight_kg, cr.estimated_weight_kg) as weight_kg,
        c.name as category_name, c.color as category_color, c.hex_color as category_hex,
        d.name as department_name,
        u_staff.full_name as staff_name,
        u_col.full_name as collector_name,
        col.vehicle_number
      FROM collection_requests cr
      LEFT JOIN waste_categories c ON cr.category_id = c.id
      LEFT JOIN departments d ON cr.department_id = d.id
      LEFT JOIN staff stf ON cr.staff_id = stf.id
      LEFT JOIN users u_staff ON stf.user_id = u_staff.id
      LEFT JOIN collectors col ON cr.collector_id = col.id
      LEFT JOIN users u_col ON col.user_id = u_col.id
      ORDER BY cr.updated_at DESC
      LIMIT 10
    `);

    // 7. Department-wise waste generation
    const departmentStats = await all(`
      SELECT 
        d.name as department_name,
        COUNT(cr.id) as request_count,
        COALESCE(SUM(COALESCE(cr.actual_weight_kg, cr.estimated_weight_kg)), 0) as total_kg
      FROM departments d
      LEFT JOIN collection_requests cr ON d.id = cr.department_id
      GROUP BY d.id
      ORDER BY total_kg DESC
      LIMIT 6
    `);

    // 8. 7-day trend
    const trendStats = await all(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        COALESCE(SUM(COALESCE(actual_weight_kg, estimated_weight_kg)), 0) as daily_kg
      FROM collection_requests
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 7
    `);

    res.json({
      success: true,
      data: {
        totalWasteKg: Math.round(weightResult.total_waste_kg * 10) / 10,
        totalRequests: weightResult.total_requests,
        pendingRequests: pendingResult.count,
        completedCollections: completedResult.count,
        activeCollectors: collectorsResult.count,
        categoryStats,
        departmentStats,
        trendStats: trendStats.reverse(),
        recentActivities
      }
    });
  } catch (error) {
    console.error('Admin dashboard stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/users - All users with role metadata
router.get('/users', async (req, res) => {
  try {
    const users = await all(`
      SELECT 
        u.id, u.username, u.email, u.role, u.full_name, u.phone, u.status, u.created_at,
        s.staff_code, s.designation, d.name as department_name,
        col.collector_code, col.vehicle_number, col.assigned_zone, col.is_active as collector_active
      FROM users u
      LEFT JOIN staff s ON u.id = s.user_id
      LEFT JOIN departments d ON s.department_id = d.id
      LEFT JOIN collectors col ON u.id = col.user_id
      ORDER BY u.created_at DESC
    `);
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/users - Create new user account (Staff, Collector, or Admin)
router.post('/users', async (req, res) => {
  try {
    const { username, email, password, role, full_name, phone, department_id, designation, vehicle_number, assigned_zone } = req.body;

    if (!username || !email || !password || !role || !full_name) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided.' });
    }

    const existing = await get('SELECT id FROM users WHERE email = ? OR username = ?', [email.trim().toLowerCase(), username.trim()]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email or Username already in use.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userResult = await run(`
      INSERT INTO users (username, email, password, role, full_name, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [username.trim(), email.trim().toLowerCase(), hashedPassword, role, full_name.trim(), phone || '']);

    const userId = userResult.id;

    if (role === 'staff') {
      const staffCode = 'STF-' + Math.floor(1000 + Math.random() * 9000);
      await run(`
        INSERT INTO staff (user_id, staff_code, department_id, designation, badge_number)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, staffCode, department_id || 1, designation || 'Staff Nurse', 'BDG-' + Math.floor(100 + Math.random() * 900)]);
    } else if (role === 'collector') {
      const colCode = 'COL-' + Math.floor(100 + Math.random() * 900);
      await run(`
        INSERT INTO collectors (user_id, collector_code, vehicle_number, assigned_zone, current_lat, current_lng, is_active)
        VALUES (?, ?, ?, ?, 12.9716, 77.5946, 1)
      `, [userId, colCode, vehicle_number || 'KA-05-BMW-1100', assigned_zone || 'Hospital Campus']);
    }

    res.status(201).json({ success: true, message: `Account created successfully for ${full_name} (${role}).` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/admin/users/:id/status - Toggle user active/inactive
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive.' });
    }

    await run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: `User status updated to ${status}.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/departments - Manage departments
router.get('/departments', async (req, res) => {
  try {
    const depts = await all(`
      SELECT d.*, COUNT(s.id) as staff_count, COUNT(cr.id) as request_count
      FROM departments d
      LEFT JOIN staff s ON d.id = s.department_id
      LEFT JOIN collection_requests cr ON d.id = cr.department_id
      GROUP BY d.id
      ORDER BY d.name ASC
    `);
    res.json({ success: true, data: depts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/departments - Add new department
router.post('/departments', async (req, res) => {
  try {
    const { name, code, floor, building, head_name, contact_number, default_lat, default_lng } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Name and Code are required.' });
    }

    await run(`
      INSERT INTO departments (name, code, floor, building, head_name, contact_number, default_lat, default_lng)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, code, floor || '1st Floor', building || 'Main Block', head_name || '', contact_number || '', parseFloat(default_lat) || 12.9716, parseFloat(default_lng) || 77.5946]);

    res.status(201).json({ success: true, message: `Department ${name} added successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/facilities - Authorized disposal treatment facilities
router.get('/facilities', async (req, res) => {
  try {
    const facilities = await all('SELECT * FROM disposal_facilities ORDER BY name ASC');
    res.json({ success: true, data: facilities });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/facilities - Add treatment facility
router.post('/facilities', async (req, res) => {
  try {
    const { name, code, facility_type, address, contact_person, contact_phone, latitude, longitude, license_number, capacity_tons_day } = req.body;
    if (!name || !code || !latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'Name, Code, Latitude and Longitude are required.' });
    }

    await run(`
      INSERT INTO disposal_facilities (name, code, facility_type, address, contact_person, contact_phone, latitude, longitude, license_number, capacity_tons_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, code, facility_type || 'Central Bio-Medical Waste Treatment Facility (CBWTF)', address || '', contact_person || '', contact_phone || '', parseFloat(latitude), parseFloat(longitude), license_number || '', parseFloat(capacity_tons_day) || 10.0]);

    res.status(201).json({ success: true, message: `Disposal Treatment Facility ${name} registered successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;


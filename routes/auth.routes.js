const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { get, run, all } = require('../db/database');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, expectedRole } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email/username and password.' });
    }

    // Lookup user by email or username
    const user = await get(
      'SELECT * FROM users WHERE email = ? OR username = ?',
      [identifier.trim().toLowerCase(), identifier.trim()]
    );

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact Admin.' });
    }

    // Role check if specified
    if (expectedRole && user.role !== expectedRole) {
      return res.status(403).json({
        success: false,
        message: `Role mismatch. You are attempting to login to the ${expectedRole} portal with a ${user.role} account.`
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid password. Please check your credentials.' });
    }

    // Create JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Fetch related profile details
    let profileData = {};
    if (user.role === 'staff') {
      profileData = await get(`
        SELECT s.*, d.name as department_name, d.code as department_code, d.floor, d.building
        FROM staff s
        LEFT JOIN departments d ON s.department_id = d.id
        WHERE s.user_id = ?
      `, [user.id]) || {};
    } else if (user.role === 'collector') {
      profileData = await get(`
        SELECT * FROM collectors WHERE user_id = ?
      `, [user.id]) || {};
    }

    return res.json({
      success: true,
      message: `Login successful. Welcome, ${user.full_name}!`,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        phone: user.phone,
        profile: profileData
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login: ' + error.message });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, full_name, phone, role, department_id, designation, vehicle_number, assigned_zone } = req.body;

    if (!username || !email || !password || !full_name || !role) {
      return res.status(400).json({ success: false, message: 'All required fields (name, username, email, password, role) must be provided.' });
    }

    if (!['staff', 'collector', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be staff, collector, or admin.' });
    }

    // Check existing
    const existing = await get('SELECT id FROM users WHERE email = ? OR username = ?', [email.trim().toLowerCase(), username.trim()]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'A user with this email or username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userResult = await run(`
      INSERT INTO users (username, email, password, role, full_name, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [username.trim(), email.trim().toLowerCase(), hashedPassword, role, full_name.trim(), phone || '']);

    const userId = userResult.id;

    // Role specific record creation
    if (role === 'staff') {
      const staffCode = 'STF-' + Math.floor(1000 + Math.random() * 9000);
      await run(`
        INSERT INTO staff (user_id, staff_code, department_id, designation, badge_number)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, staffCode, department_id || 1, designation || 'Nursing Officer', 'BADGE-' + Math.floor(100 + Math.random() * 900)]);
    } else if (role === 'collector') {
      const collectorCode = 'COL-' + Math.floor(100 + Math.random() * 900);
      await run(`
        INSERT INTO collectors (user_id, collector_code, vehicle_number, assigned_zone, current_lat, current_lng, is_active)
        VALUES (?, ?, ?, ?, 12.9716, 77.5946, 1)
      `, [userId, collectorCode, vehicle_number || 'KA-05-BMW-00' + Math.floor(10 + Math.random() * 89), assigned_zone || 'Central Hospital Zone']);
    }

    res.status(201).json({
      success: true,
      message: `Registration successful for ${role}. You can now log in!`
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Registration failed: ' + error.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  res.json({
    success: true,
    user: req.user,
    staff: req.staff || null,
    collector: req.collector || null
  });
});

module.exports = router;


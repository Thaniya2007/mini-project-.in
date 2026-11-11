const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Staff, Department, Collector, getNextId } = require('../db/models');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { identifier, password, expectedRole } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email/username and password.' });
    }

    const cleanId = identifier.trim();
    const user = await User.findOne({
      $or: [
        { email: cleanId.toLowerCase() },
        { username: cleanId }
      ]
    }).lean();

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact Admin.' });
    }

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

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    let profileData = {};
    if (user.role === 'staff') {
      const staff = await Staff.findOne({ user_id: user.id }).lean();
      if (staff) {
        const dept = await Department.findOne({ id: staff.department_id }).lean();
        profileData = {
          ...staff,
          department_name: dept ? dept.name : null,
          department_code: dept ? dept.code : null,
          floor: dept ? dept.floor : null,
          building: dept ? dept.building : null
        };
      }
    } else if (user.role === 'collector') {
      profileData = await Collector.findOne({ user_id: user.id }).lean() || {};
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

    const existing = await User.findOne({
      $or: [
        { email: email.trim().toLowerCase() },
        { username: username.trim() }
      ]
    }).lean();

    if (existing) {
      return res.status(400).json({ success: false, message: 'A user with this email or username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await getNextId('users');
    await User.create({
      id: userId,
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      role,
      full_name: full_name.trim(),
      phone: phone || ''
    });

    if (role === 'staff') {
      const staffId = await getNextId('staff');
      const staffCode = 'STF-' + Math.floor(1000 + Math.random() * 9000);
      await Staff.create({
        id: staffId,
        user_id: userId,
        staff_code: staffCode,
        department_id: parseInt(department_id) || 1,
        designation: designation || 'Nursing Officer',
        badge_number: 'BADGE-' + Math.floor(100 + Math.random() * 900)
      });
    } else if (role === 'collector') {
      const colId = await getNextId('collectors');
      const collectorCode = 'COL-' + Math.floor(100 + Math.random() * 900);
      await Collector.create({
        id: colId,
        user_id: userId,
        collector_code: collectorCode,
        vehicle_number: vehicle_number || 'KA-05-BMW-00' + Math.floor(10 + Math.random() * 89),
        assigned_zone: assigned_zone || 'Central Hospital Zone',
        current_lat: 12.9716,
        current_lng: 77.5946,
        is_active: 1
      });
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

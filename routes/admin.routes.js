const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const {
  User,
  Department,
  Staff,
  Collector,
  WasteCategory,
  DisposalFacility,
  CollectionRequest,
  getNextId
} = require('../db/models');
const { enrichRequests } = require('../db/helpers');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.use(authenticateToken);
router.use(requireRole('admin'));

// GET /api/admin/dashboard-stats - Complete summary cards and charts
router.get('/dashboard-stats', async (req, res) => {
  try {
    const [allRequests, categories, departments, activeCollectorsCount] = await Promise.all([
      CollectionRequest.find({}).sort({ updated_at: -1 }).lean(),
      WasteCategory.find({}).sort({ id: 1 }).lean(),
      Department.find({}).lean(),
      Collector.countDocuments({ is_active: 1 })
    ]);

    let totalWasteKg = 0;
    let pendingRequests = 0;
    let completedCollections = 0;

    const catStatsMap = new Map(categories.map(c => [
      c.id,
      { id: c.id, name: c.name, color: c.color, hex_color: c.hex_color, request_count: 0, total_kg: 0 }
    ]));
    const deptStatsMap = new Map(departments.map(d => [
      d.id,
      { department_name: d.name, request_count: 0, total_kg: 0 }
    ]));
    const trendMap = new Map();

    allRequests.forEach(r => {
      const weight = parseFloat(r.actual_weight_kg ?? r.estimated_weight_kg ?? 0) || 0;
      totalWasteKg += weight;

      if (r.status === 'Completed' || r.status === 'Handed Over to Authorized Treatment Facility') {
        completedCollections++;
      } else {
        pendingRequests++;
      }

      if (catStatsMap.has(r.category_id)) {
        const entry = catStatsMap.get(r.category_id);
        entry.request_count++;
        entry.total_kg += weight;
      }

      if (deptStatsMap.has(r.department_id)) {
        const entry = deptStatsMap.get(r.department_id);
        entry.request_count++;
        entry.total_kg += weight;
      }

      const dateKey = new Date(r.created_at).toISOString().slice(0, 10);
      const t = trendMap.get(dateKey) || { date: dateKey, count: 0, daily_kg: 0 };
      t.count++;
      t.daily_kg += weight;
      trendMap.set(dateKey, t);
    });

    const categoryStats = Array.from(catStatsMap.values()).sort((a, b) => a.id - b.id);
    const departmentStats = Array.from(deptStatsMap.values())
      .sort((a, b) => b.total_kg - a.total_kg)
      .slice(0, 6);
    const trendStats = Array.from(trendMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7);

    const enrichedRecent = await enrichRequests(allRequests.slice(0, 10));
    const recentActivities = enrichedRecent.map(r => ({
      id: r.id,
      request_number: r.request_number,
      status: r.status,
      priority: r.priority,
      created_at: r.created_at,
      updated_at: r.updated_at,
      weight_kg: r.actual_weight_kg ?? r.estimated_weight_kg,
      category_name: r.category_name,
      category_color: r.category_color,
      category_hex: r.category_hex,
      department_name: r.department_name,
      staff_name: r.staff_name,
      collector_name: r.collector_name,
      vehicle_number: r.vehicle_number
    }));

    res.json({
      success: true,
      data: {
        totalWasteKg: Math.round(totalWasteKg * 10) / 10,
        totalRequests: allRequests.length,
        pendingRequests,
        completedCollections,
        activeCollectors: activeCollectorsCount,
        categoryStats,
        departmentStats,
        trendStats,
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
    const [users, staffList, departments, collectors] = await Promise.all([
      User.find({}).select('id username email role full_name phone status created_at -_id').sort({ created_at: -1 }).lean(),
      Staff.find({}).lean(),
      Department.find({}).lean(),
      Collector.find({}).lean()
    ]);

    const deptMap = new Map(departments.map(d => [d.id, d]));
    const staffByUser = new Map(staffList.map(s => [s.user_id, s]));
    const colByUser = new Map(collectors.map(c => [c.user_id, c]));

    const data = users.map(u => {
      const s = staffByUser.get(u.id);
      const col = colByUser.get(u.id);
      const dept = s ? deptMap.get(s.department_id) : null;
      return {
        ...u,
        staff_id: s ? s.id : null,
        staff_code: s ? s.staff_code : null,
        designation: s ? s.designation : null,
        department_name: dept ? dept.name : null,
        collector_id: col ? col.id : null,
        collector_code: col ? col.collector_code : null,
        vehicle_number: col ? col.vehicle_number : null,
        assigned_zone: col ? col.assigned_zone : null,
        collector_active: col ? col.is_active : null
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/admin/users - Create new user account
router.post('/users', async (req, res) => {
  try {
    const { username, email, password, role, full_name, phone, department_id, designation, vehicle_number, assigned_zone } = req.body;

    if (!username || !email || !password || !role || !full_name) {
      return res.status(400).json({ success: false, message: 'All required fields must be provided.' });
    }

    const existing = await User.findOne({
      $or: [
        { email: email.trim().toLowerCase() },
        { username: username.trim() }
      ]
    }).lean();

    if (existing) {
      return res.status(400).json({ success: false, message: 'Email or Username already in use.' });
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
        designation: designation || 'Staff Nurse',
        badge_number: 'BDG-' + Math.floor(100 + Math.random() * 900)
      });
    } else if (role === 'collector') {
      const colId = await getNextId('collectors');
      const colCode = 'COL-' + Math.floor(100 + Math.random() * 900);
      await Collector.create({
        id: colId,
        user_id: userId,
        collector_code: colCode,
        vehicle_number: vehicle_number || 'KA-05-BMW-1100',
        assigned_zone: assigned_zone || 'Hospital Campus',
        current_lat: 12.9716,
        current_lng: 77.5946,
        is_active: 1
      });
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

    await User.updateOne({ id: parseInt(req.params.id) }, { status });
    res.json({ success: true, message: `User status updated to ${status}.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/departments - Manage departments
router.get('/departments', async (req, res) => {
  try {
    const [depts, staffList, requests] = await Promise.all([
      Department.find({}).sort({ name: 1 }).lean(),
      Staff.find({}).select('department_id').lean(),
      CollectionRequest.find({}).select('department_id').lean()
    ]);

    const staffCountMap = new Map();
    staffList.forEach(s => staffCountMap.set(s.department_id, (staffCountMap.get(s.department_id) || 0) + 1));

    const reqCountMap = new Map();
    requests.forEach(r => reqCountMap.set(r.department_id, (reqCountMap.get(r.department_id) || 0) + 1));

    const data = depts.map(d => ({
      ...d,
      staff_count: staffCountMap.get(d.id) || 0,
      request_count: reqCountMap.get(d.id) || 0
    }));

    res.json({ success: true, data });
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

    const id = await getNextId('departments');
    await Department.create({
      id,
      name,
      code,
      floor: floor || '1st Floor',
      building: building || 'Main Block',
      head_name: head_name || '',
      contact_number: contact_number || '',
      default_lat: parseFloat(default_lat) || 12.9716,
      default_lng: parseFloat(default_lng) || 77.5946
    });

    res.status(201).json({ success: true, message: `Department ${name} added successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/admin/facilities - Authorized disposal treatment facilities
router.get('/facilities', async (req, res) => {
  try {
    const facilities = await DisposalFacility.find({}).sort({ name: 1 }).lean();
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

    const id = await getNextId('disposal_facilities');
    await DisposalFacility.create({
      id,
      name,
      code,
      facility_type: facility_type || 'Central Bio-Medical Waste Treatment Facility (CBWTF)',
      address: address || '',
      contact_person: contact_person || '',
      contact_phone: contact_phone || '',
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      license_number: license_number || '',
      capacity_tons_day: parseFloat(capacity_tons_day) || 10.0,
      status: 'Active'
    });

    res.status(201).json({ success: true, message: `Disposal Treatment Facility ${name} registered successfully.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

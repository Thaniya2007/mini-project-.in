const jwt = require('jsonwebtoken');
const { User, Staff, Department, Collector } = require('../db/models');

const JWT_SECRET = process.env.JWT_SECRET || 'smart-hospital-biomedical-waste-mgmt-secret-2026';

// Middleware to authenticate JWT token
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No authentication token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findOne({ id: decoded.id })
      .select('id username email role full_name phone status -_id')
      .lean();

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token. User no longer exists.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact the administrator.' });
    }

    req.user = user;

    if (user.role === 'staff') {
      const staff = await Staff.findOne({ user_id: user.id }).lean();
      if (staff) {
        const dept = await Department.findOne({ id: staff.department_id }).lean();
        req.staff = {
          staff_id: staff.id,
          staff_code: staff.staff_code,
          department_id: staff.department_id,
          designation: staff.designation,
          badge_number: staff.badge_number,
          department_name: dept ? dept.name : null,
          department_code: dept ? dept.code : null
        };
      }
    } else if (user.role === 'collector') {
      const collector = await Collector.findOne({ user_id: user.id }).lean();
      if (collector) {
        req.collector = {
          collector_id: collector.id,
          collector_code: collector.collector_code,
          vehicle_number: collector.vehicle_number,
          vehicle_type: collector.vehicle_type,
          assigned_zone: collector.assigned_zone,
          current_lat: collector.current_lat,
          current_lng: collector.current_lng,
          is_active: collector.is_active
        };
      }
    }

    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
}

// Middleware to enforce specific roles
function requireRole(allowedRoles) {
  if (typeof allowedRoles === 'string') {
    allowedRoles = [allowedRoles];
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. This resource requires one of the following roles: [${allowedRoles.join(', ')}]. You are logged in as [${req.user.role}].`
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole,
  JWT_SECRET
};

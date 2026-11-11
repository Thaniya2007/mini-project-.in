const jwt = require('jsonwebtoken');
const { get } = require('../db/database');

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
    
    // Fetch user details from database to ensure account is active
    const user = await get('SELECT id, username, email, role, full_name, phone, status FROM users WHERE id = ?', [decoded.id]);
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token. User no longer exists.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact the administrator.' });
    }

    req.user = user;

    // Attach staff or collector metadata if applicable
    if (user.role === 'staff') {
      const staffInfo = await get(`
        SELECT s.id as staff_id, s.staff_code, s.department_id, s.designation, s.badge_number,
               d.name as department_name, d.code as department_code
        FROM staff s
        LEFT JOIN departments d ON s.department_id = d.id
        WHERE s.user_id = ?
      `, [user.id]);
      req.staff = staffInfo;
    } else if (user.role === 'collector') {
      const collectorInfo = await get(`
        SELECT c.id as collector_id, c.collector_code, c.vehicle_number, c.vehicle_type, c.assigned_zone, c.current_lat, c.current_lng, c.is_active
        FROM collectors c
        WHERE c.user_id = ?
      `, [user.id]);
      req.collector = collectorInfo;
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


require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/database');
const { UploadedFile } = require('./db/models');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration (supports Vercel frontend + local development)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Static directories (fallback/local frontend and static assets)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve MongoDB-persisted uploaded photos
app.get('/api/uploads/:id', async (req, res) => {
  try {
    const fileId = parseInt(req.params.id);
    const fileDoc = await UploadedFile.findOne({ id: fileId });
    if (!fileDoc) {
      return res.status(404).json({ success: false, message: 'Uploaded image not found.' });
    }
    res.set('Content-Type', fileDoc.mimetype || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(fileDoc.data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/waste', require('./routes/waste.routes'));
app.use('/api/requests', require('./routes/requests.routes'));
app.use('/api/gps', require('./routes/gps.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

// Health check endpoint (used by Render healthCheckPath)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'Smart Hospital Waste Management System',
    database: 'MongoDB',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    modules: ['Waste Segregation', 'Role-Based Authentication', 'GPS Tracking', 'Reports Generation']
  });
});

// Single Page routes for clean navigation
app.get('/staff', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'staff-dashboard.html'));
});

app.get('/collector', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'collector-dashboard.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : undefined
  });
});

// Start Server after MongoDB initialization
initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log('================================================================');
      console.log('SMART HOSPITAL WASTE MANAGEMENT SYSTEM is LIVE (MongoDB)!');
      console.log(`Server running on port: ${PORT}`);
      console.log(`Staff Dashboard:    /staff`);
      console.log(`Collector Portal:   /collector`);
      console.log(`Admin Console:      /admin`);
      console.log('================================================================');
    });
  })
  .catch((err) => {
    console.error('Failed to initialize MongoDB database:', err);
    process.exit(1);
  });

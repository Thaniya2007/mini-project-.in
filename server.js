const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Static directories
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/waste', require('./routes/waste.routes'));
app.use('/api/requests', require('./routes/requests.routes'));
app.use('/api/gps', require('./routes/gps.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'Smart Hospital Waste Management System',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    modules: ['Waste Segregation', 'Role-Based Authentication', 'GPS Tracking', 'Reports Generation']
  });
});

// Single Page fallback routes for clean navigation
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

// Start Server after Database initialization
initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`================================================================`);
      console.log(`🏥 SMART HOSPITAL WASTE MANAGEMENT SYSTEM is LIVE!`);
      console.log(`🌐 Server running at: http://localhost:${PORT}`);
      console.log(`📋 Staff Dashboard:    http://localhost:${PORT}/staff`);
      console.log(`🚚 Collector Portal:   http://localhost:${PORT}/collector`);
      console.log(`🛡️ Admin Console:     http://localhost:${PORT}/admin`);
      console.log(`================================================================`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

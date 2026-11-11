const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { CollectionRequest } = require('../db/models');
const { enrichRequests } = require('../db/helpers');
const { authenticateToken } = require('../middleware/auth');

/** Builds MongoDB filter object from report query parameters. */
function buildMongoFilter(filters) {
  const query = {};
  const {
    period,
    date_from,
    date_to,
    category_id,
    department_id,
    staff_id,
    collector_id,
    status
  } = filters;

  const now = new Date();
  if (period === 'daily') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    query.created_at = { $gte: startOfDay };
  } else if (period === 'weekly') {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    query.created_at = { $gte: weekAgo };
  } else if (period === 'monthly') {
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    query.created_at = { $gte: monthAgo };
  } else if (date_from || date_to) {
    query.created_at = {};
    if (date_from) query.created_at.$gte = new Date(date_from);
    if (date_to) {
      const end = new Date(date_to);
      end.setHours(23, 59, 59, 999);
      query.created_at.$lte = end;
    }
  }

  if (category_id && category_id !== 'all') query.category_id = parseInt(category_id);
  if (department_id && department_id !== 'all') query.department_id = parseInt(department_id);
  if (staff_id && staff_id !== 'all') query.staff_id = parseInt(staff_id);
  if (collector_id && collector_id !== 'all') query.collector_id = parseInt(collector_id);
  if (status && status !== 'all') query.status = status;

  return query;
}

// GET /api/reports/query - Filtered report records
router.get('/query', authenticateToken, async (req, res) => {
  try {
    const filter = buildMongoFilter(req.query);
    const raw = await CollectionRequest.find(filter).sort({ created_at: -1 }).lean();
    const records = await enrichRequests(raw);

    let totalWeight = 0;
    let completedCount = 0;
    let pendingCount = 0;
    const categoryBreakdown = {};
    const departmentBreakdown = {};

    records.forEach(r => {
      const w = parseFloat(r.quantity_kg) || 0;
      totalWeight += w;
      if (r.status === 'Completed' || r.status === 'Handed Over to Authorized Treatment Facility') {
        completedCount++;
      } else {
        pendingCount++;
      }

      if (r.category_color) {
        categoryBreakdown[r.category_color] = (categoryBreakdown[r.category_color] || 0) + w;
      }
      if (r.department_name) {
        departmentBreakdown[r.department_name] = (departmentBreakdown[r.department_name] || 0) + w;
      }
    });

    res.json({
      success: true,
      summary: {
        totalRecords: records.length,
        totalWeightKg: Math.round(totalWeight * 100) / 100,
        completedCount,
        pendingCount,
        categoryBreakdown,
        departmentBreakdown
      },
      data: records
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/export/excel - Generates and downloads Excel spreadsheet (.xlsx)
router.get('/export/excel', authenticateToken, async (req, res) => {
  try {
    const filter = buildMongoFilter(req.query);
    const raw = await CollectionRequest.find(filter).sort({ created_at: -1 }).lean();
    const records = await enrichRequests(raw);

    const excelRows = records.map((r, idx) => ({
      'SL No': idx + 1,
      'Request Code': r.request_number,
      'Date & Time': new Date(r.created_at).toLocaleString(),
      'Hospital Department': r.department_name || 'N/A',
      'Department Code': r.department_code || 'N/A',
      'Room / Ward': r.room_number,
      'Waste Category': r.category_name || 'N/A',
      'Bin Color': (r.category_color || 'N/A').toUpperCase(),
      'Est. Quantity (kg)': r.estimated_weight_kg,
      'Actual Quantity (kg)': r.actual_weight_kg || r.estimated_weight_kg,
      'Priority': r.priority,
      'Current Status': r.status,
      'Staff Name': r.staff_name || 'N/A',
      'Staff Code': r.staff_code || 'N/A',
      'Collector Name': r.collector_name || 'Pending Assignment',
      'Collector Code': r.collector_code || 'N/A',
      'Vehicle Number': r.vehicle_number || 'N/A',
      'GPS Coordinates': `${r.collection_lat || 0}, ${r.collection_lng || 0}`,
      'Collection Location': r.collection_address || 'Hospital Campus',
      'Disposal Treatment Facility': r.facility_name || 'Pending Transfer',
      'Facility License': r.facility_license || 'N/A',
      'Handover Notes / Verification': r.handover_notes || 'None'
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelRows);

    ws['!cols'] = [
      { wch: 6 }, { wch: 18 }, { wch: 20 }, { wch: 25 }, { wch: 15 },
      { wch: 20 }, { wch: 25 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
      { wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 14 }, { wch: 22 },
      { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 30 }, { wch: 35 },
      { wch: 22 }, { wch: 35 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'BMW Collection Report');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `Hospital_Biomedical_Waste_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate Excel report: ' + error.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { get, run, all } = require('../db/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Helper to build filtering SQL
function buildReportQuery(filters) {
  let whereClauses = [];
  let params = [];

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

  // Period filtering
  const now = new Date();
  if (period === 'daily') {
    whereClauses.push("DATE(cr.created_at) = DATE('now', 'localtime')");
  } else if (period === 'weekly') {
    whereClauses.push("cr.created_at >= DATETIME('now', '-7 days', 'localtime')");
  } else if (period === 'monthly') {
    whereClauses.push("cr.created_at >= DATETIME('now', '-30 days', 'localtime')");
  } else {
    if (date_from) {
      whereClauses.push("DATE(cr.created_at) >= DATE(?)");
      params.push(date_from);
    }
    if (date_to) {
      whereClauses.push("DATE(cr.created_at) <= DATE(?)");
      params.push(date_to);
    }
  }

  if (category_id && category_id !== 'all') {
    whereClauses.push("cr.category_id = ?");
    params.push(parseInt(category_id));
  }

  if (department_id && department_id !== 'all') {
    whereClauses.push("cr.department_id = ?");
    params.push(parseInt(department_id));
  }

  if (staff_id && staff_id !== 'all') {
    whereClauses.push("cr.staff_id = ?");
    params.push(parseInt(staff_id));
  }

  if (collector_id && collector_id !== 'all') {
    whereClauses.push("cr.collector_id = ?");
    params.push(parseInt(collector_id));
  }

  if (status && status !== 'all') {
    whereClauses.push("cr.status = ?");
    params.push(status);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sql = `
    SELECT 
      cr.id,
      cr.request_number,
      cr.created_at,
      cr.updated_at,
      cr.room_number,
      cr.priority,
      cr.status,
      cr.estimated_weight_kg,
      COALESCE(cr.actual_weight_kg, cr.estimated_weight_kg) as quantity_kg,
      cr.actual_weight_kg,
      cr.waste_photo,
      cr.proof_photo,
      cr.collection_lat,
      cr.collection_lng,
      cr.collection_address,
      cr.handover_notes,
      c.id as category_id,
      c.name as category_name,
      c.code as category_code,
      c.color as category_color,
      c.hex_color as category_hex,
      d.id as department_id,
      d.name as department_name,
      d.code as department_code,
      d.floor as department_floor,
      d.building as department_building,
      stf.id as staff_id,
      stf.staff_code,
      u_staff.full_name as staff_name,
      col.id as collector_id,
      col.collector_code,
      col.vehicle_number,
      u_col.full_name as collector_name,
      fac.name as facility_name,
      fac.code as facility_code,
      fac.license_number as facility_license,
      fac.address as facility_address
    FROM collection_requests cr
    LEFT JOIN waste_categories c ON cr.category_id = c.id
    LEFT JOIN departments d ON cr.department_id = d.id
    LEFT JOIN staff stf ON cr.staff_id = stf.id
    LEFT JOIN users u_staff ON stf.user_id = u_staff.id
    LEFT JOIN collectors col ON cr.collector_id = col.id
    LEFT JOIN users u_col ON col.user_id = u_col.id
    LEFT JOIN disposal_facilities fac ON cr.disposal_facility_id = fac.id
    ${whereSQL}
    ORDER BY cr.created_at DESC
  `;

  return { sql, params };
}

// GET /api/reports/query - Filtered report records
router.get('/query', authenticateToken, async (req, res) => {
  try {
    const { sql, params } = buildReportQuery(req.query);
    const records = await all(sql, params);

    // Compute aggregates
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

      // Category breakdown
      categoryBreakdown[r.category_color] = (categoryBreakdown[r.category_color] || 0) + w;
      // Department breakdown
      departmentBreakdown[r.department_name] = (departmentBreakdown[r.department_name] || 0) + w;
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
    const { sql, params } = buildReportQuery(req.query);
    const records = await all(sql, params);

    // Transform into clean tabular rows
    const excelRows = records.map((r, idx) => ({
      'SL No': idx + 1,
      'Request Code': r.request_number,
      'Date & Time': new Date(r.created_at).toLocaleString(),
      'Hospital Department': r.department_name,
      'Department Code': r.department_code,
      'Room / Ward': r.room_number,
      'Waste Category': r.category_name,
      'Bin Color': r.category_color.toUpperCase(),
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

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelRows);

    // Auto-fit column widths
    const colWidths = [
      { wch: 6 },  // SL No
      { wch: 18 }, // Request Code
      { wch: 20 }, // Date & Time
      { wch: 25 }, // Department
      { wch: 15 }, // Dept Code
      { wch: 20 }, // Room
      { wch: 25 }, // Category
      { wch: 12 }, // Bin Color
      { wch: 14 }, // Est Qty
      { wch: 14 }, // Act Qty
      { wch: 12 }, // Priority
      { wch: 25 }, // Status
      { wch: 22 }, // Staff
      { wch: 14 }, // Staff Code
      { wch: 22 }, // Collector
      { wch: 14 }, // Collector Code
      { wch: 16 }, // Vehicle
      { wch: 22 }, // Coordinates
      { wch: 30 }, // Location
      { wch: 35 }, // Facility
      { wch: 22 }, // License
      { wch: 35 }  // Notes
    ];
    ws['!cols'] = colWidths;

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


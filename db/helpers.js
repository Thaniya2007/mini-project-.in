const {
  User,
  Department,
  Staff,
  Collector,
  WasteCategory,
  DisposalFacility
} = require('./models');

/**
 * Enriches collection request documents with related category, department,
 * staff, collector, and disposal facility fields matching the API contract.
 */
async function enrichRequests(requests) {
  if (!requests || requests.length === 0) return [];

  const [categories, departments, staffList, collectors, facilities] = await Promise.all([
    WasteCategory.find({}).lean(),
    Department.find({}).lean(),
    Staff.find({}).lean(),
    Collector.find({}).lean(),
    DisposalFacility.find({}).lean()
  ]);

  const userIds = new Set();
  staffList.forEach(s => userIds.add(s.user_id));
  collectors.forEach(c => userIds.add(c.user_id));
  const users = await User.find({ id: { $in: Array.from(userIds) } })
    .select('id full_name phone email username role')
    .lean();

  const catMap = new Map(categories.map(c => [c.id, c]));
  const deptMap = new Map(departments.map(d => [d.id, d]));
  const staffMap = new Map(staffList.map(s => [s.id, s]));
  const collectorMap = new Map(collectors.map(c => [c.id, c]));
  const facilityMap = new Map(facilities.map(f => [f.id, f]));
  const userMap = new Map(users.map(u => [u.id, u]));

  return requests.map(cr => {
    const cat = catMap.get(cr.category_id) || {};
    const dept = deptMap.get(cr.department_id) || {};
    const stf = staffMap.get(cr.staff_id) || {};
    const staffUser = userMap.get(stf.user_id) || {};
    const col = collectorMap.get(cr.collector_id) || {};
    const colUser = userMap.get(col.user_id) || {};
    const fac = facilityMap.get(cr.disposal_facility_id) || {};

    return {
      ...cr,
      quantity_kg: cr.actual_weight_kg !== null && cr.actual_weight_kg !== undefined
        ? cr.actual_weight_kg
        : cr.estimated_weight_kg,
      category_name: cat.name || null,
      category_code: cat.code || null,
      category_color: cat.color || null,
      category_hex: cat.hex_color || null,
      badge_class: cat.badge_class || null,
      example_items: cat.example_items || null,
      segregation_rules: cat.segregation_rules || null,
      department_name: dept.name || null,
      department_code: dept.code || null,
      floor: dept.floor || null,
      building: dept.building || null,
      department_floor: dept.floor || null,
      department_building: dept.building || null,
      dept_head: dept.head_name || null,
      dept_contact: dept.contact_number || null,
      staff_code: stf.staff_code || null,
      staff_designation: stf.designation || null,
      staff_name: staffUser.full_name || null,
      staff_phone: staffUser.phone || null,
      collector_code: col.collector_code || null,
      vehicle_number: col.vehicle_number || null,
      vehicle_type: col.vehicle_type || null,
      collector_name: colUser.full_name || null,
      collector_phone: colUser.phone || null,
      facility_name: fac.name || null,
      facility_code: fac.code || null,
      facility_address: fac.address || null,
      facility_type: fac.facility_type || null,
      facility_contact: fac.contact_person || null,
      facility_phone: fac.contact_phone || null,
      facility_lat: fac.latitude ?? null,
      facility_lng: fac.longitude ?? null,
      facility_license: fac.license_number || null
    };
  });
}

module.exports = { enrichRequests };


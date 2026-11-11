const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const {
  User,
  Department,
  Staff,
  Collector,
  WasteCategory,
  DisposalFacility,
  CollectionRequest,
  WasteRecord,
  GpsLocation,
  CollectionHistory,
  UploadedFile,
  getNextId
} = require('./models');

/** Connects to MongoDB and initializes + seeds baseline hospital biomedical waste data. */
async function initDatabase(uriOverride) {
  const mongoUri = uriOverride || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hospital_waste';

  if (!process.env.MONGODB_URI && !uriOverride) {
    console.warn('Warning: MONGODB_URI env variable not set. Attempting local MongoDB at mongodb://127.0.0.1:27017/hospital_waste');
  }

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000
    });
    console.log('Connected to MongoDB database successfully.');
  }

  await seedInitialData();
}

/** Saves an uploaded image buffer into MongoDB and returns its public API path. */
async function saveUploadedFile(file, folder = 'waste') {
  if (!file || !file.buffer) return null;
  const id = await getNextId('uploaded_files');
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const filename = `${file.fieldname || 'file'}-${uniqueSuffix}-${file.originalname || 'upload.jpg'}`;

  await UploadedFile.create({
    id,
    filename,
    mimetype: file.mimetype || 'image/jpeg',
    data: file.buffer,
    size: file.size || file.buffer.length,
    folder
  });

  return `/api/uploads/${id}`;
}

async function seedInitialData() {
  // 1. Seed Waste Categories
  const catCount = await WasteCategory.countDocuments();
  if (catCount === 0) {
    console.log('Seeding Waste Categories...');
    const categories = [
      {
        name: 'Infectious & Pathological Waste',
        code: 'YELLOW',
        color: 'Yellow',
        hex_color: '#EAB308',
        badge_class: 'bg-yellow-100 text-yellow-800 border-yellow-300',
        description: 'Highly infectious waste, human anatomical items, organs, tissues, blood-soaked swabs, expired pharmaceuticals, and microbiology laboratory cultures.',
        example_items: 'Human anatomical tissues; Blood-soaked cotton & dressings; Expired medicines & cytotoxic drugs; Microbial cultures & specimen containers; Placenta & biopsy samples',
        segregation_rules: 'Must be placed in non-chlorinated yellow plastic bags. Seal tightly with zip-ties when 3/4th full. Incineration or plasma pyrolysis required at authorized CBWTF.',
        handling_instructions: 'Wear double nitrile gloves, N95 mask, and biohazard protective apron. Never compress by hand. Treat within 48 hours as per biomedical guidelines.',
        icon: 'biohazard'
      },
      {
        name: 'Contaminated Recyclable Plastics',
        code: 'RED',
        color: 'Red',
        hex_color: '#EF4444',
        badge_class: 'bg-red-100 text-red-800 border-red-300',
        description: 'Contaminated recyclable plastic waste generated from medical consumables such as tubing, bottles, catheters, and disposable containers.',
        example_items: 'Disposable gloves; IV drip bottles & tubes; Urinary bags & catheters; Dialysis kits; Syringes without needles & vacutainers',
        segregation_rules: 'Segregate in red puncture-proof or non-chlorinated red bags. Must be autoclaved/microwaved followed by shredding and registered recycling.',
        handling_instructions: 'Empty residual bodily fluids before disposal. Ensure sharp needles are detached. Handle with PPE and transfer to designated autoclaving unit.',
        icon: 'recycle'
      },
      {
        name: 'Sharps & Contaminated Metals',
        code: 'WHITE',
        color: 'White',
        hex_color: '#F8FAFC',
        badge_class: 'bg-slate-100 text-slate-800 border-slate-300',
        description: 'Puncture, cut, or slice hazards including needles, surgical blades, scalpels, and contaminated metal sharp instruments.',
        example_items: 'Hypodermic needles; Scalpels & surgical blades; Suture needles; Lancets & stylets; Contaminated stainless steel trocars',
        segregation_rules: 'Must be placed directly in tamper-proof, puncture-proof, leak-proof translucent white sharps containers. Autoclaving followed by metal recovery.',
        handling_instructions: 'Never bend, break or recap needles. Drop directly into sharp container immediately after use. Lock container when fill-line is reached.',
        icon: 'scissors'
      },
      {
        name: 'Glassware & Metallic Implants',
        code: 'BLUE',
        color: 'Blue',
        hex_color: '#2563EB',
        badge_class: 'bg-blue-100 text-blue-800 border-blue-300',
        description: 'Broken or intact medicine glass vials, ampoules, glass slides, and orthopedic or dental metallic implants.',
        example_items: 'Medicine glass vials & ampoules; Glass slides & cover slips; Orthopedic metallic implants & plates; Dental metal prosthetics; IV glass bottles',
        segregation_rules: 'Store in cardboard boxes or blue-marked rigid puncture-resistant plastic containers. Disinfection via sodium hypochlorite immersion or autoclaving.',
        handling_instructions: 'Carefully dispose of broken ampoules to avoid cuts. Ensure cytotoxic glass is segregated into yellow containers instead.',
        icon: 'flask-conical'
      }
    ];

    for (const cat of categories) {
      const id = await getNextId('waste_categories');
      await WasteCategory.create({ id, ...cat });
    }
  }

  // 2. Seed Hospital Departments
  const deptCount = await Department.countDocuments();
  if (deptCount === 0) {
    console.log('Seeding Hospital Departments...');
    const depts = [
      { name: 'Emergency & Trauma Care', code: 'EMR-01', floor: 'Ground Floor', building: 'Main Block A', head_name: 'Dr. Ramesh Rao', contact_number: '+91 98450 11001', default_lat: 12.9716, default_lng: 77.5946 },
      { name: 'Operation Theatre Complex (OT)', code: 'SURG-OT', floor: '3rd Floor', building: 'Surgical Tower', head_name: 'Dr. Priya Nambiar', contact_number: '+91 98450 11002', default_lat: 12.9718, default_lng: 77.5948 },
      { name: 'Intensive Care Unit (ICU)', code: 'ICU-02', floor: '2nd Floor', building: 'Critical Care Block', head_name: 'Dr. Sanjay Gupta', contact_number: '+91 98450 11003', default_lat: 12.9715, default_lng: 77.5944 },
      { name: 'Pathology & Microbiology Lab', code: 'PATH-LAB', floor: '1st Floor', building: 'Diagnostic Wing', head_name: 'Dr. Sunita Patel', contact_number: '+91 98450 11004', default_lat: 12.9719, default_lng: 77.5949 },
      { name: 'Oncology & Chemotherapy Ward', code: 'ONC-04', floor: '4th Floor', building: 'Super Specialty Wing', head_name: 'Dr. Farhan Ali', contact_number: '+91 98450 11005', default_lat: 12.9713, default_lng: 77.5943 },
      { name: 'Pediatrics & Neonatal ICU (NICU)', code: 'PED-NICU', floor: '2nd Floor', building: 'Mother & Child Block', head_name: 'Dr. Meera Menon', contact_number: '+91 98450 11006', default_lat: 12.9720, default_lng: 77.5951 },
      { name: 'General Medicine & Inpatient Wards', code: 'GEN-WARD', floor: '5th Floor', building: 'Main Block A', head_name: 'Dr. Arun Vernekar', contact_number: '+91 98450 11007', default_lat: 12.9717, default_lng: 77.5947 },
      { name: 'Central Pharmacy & Dialysis Unit', code: 'PHARM-DIA', floor: 'Ground Floor', building: 'West Wing', head_name: 'Dr. Deepa Shenoy', contact_number: '+91 98450 11008', default_lat: 12.9714, default_lng: 77.5945 }
    ];

    for (const d of depts) {
      const id = await getNextId('departments');
      await Department.create({ id, ...d });
    }
  }

  // 3. Seed Disposal Facilities
  const facilityCount = await DisposalFacility.countDocuments();
  if (facilityCount === 0) {
    console.log('Seeding Authorized Bio-Medical Waste Treatment Facilities (CBWTF)...');
    const facilities = [
      {
        name: 'Apex Central Bio-Medical Waste Treatment Facility (CBWTF)',
        code: 'CBWTF-APEX-01',
        facility_type: 'Central Bio-Medical Waste Treatment Facility (CBWTF)',
        address: 'Plot 48, Industrial Pollution Control Complex, Peenya Industrial Area, Bengaluru',
        contact_person: 'Mr. Arvind Sheshadri (Chief Environment Officer)',
        contact_phone: '+91 98440 55660',
        latitude: 12.9856,
        longitude: 77.5810,
        license_number: 'CPCB-BMW-KA-2024-8891',
        capacity_tons_day: 12.5,
        status: 'Active'
      },
      {
        name: 'Metro High-Temperature Incineration & Pyrolysis Plant',
        code: 'CBWTF-INCIN-02',
        facility_type: 'Incinerator & Plasma Pyrolysis Center',
        address: 'Sector 9, Eco-Tech Disposal Hub, Hosur Road Corridor, Bengaluru',
        contact_person: 'Ms. Nalini Krishnan (Safety Director)',
        contact_phone: '+91 98440 55661',
        latitude: 12.9550,
        longitude: 77.6100,
        license_number: 'CPCB-BMW-KA-2023-4412',
        capacity_tons_day: 8.0,
        status: 'Active'
      },
      {
        name: 'GreenShield Autoclave, Microwave & Shredding Hub',
        code: 'CBWTF-AUTO-03',
        facility_type: 'Autoclave & Plastics Recycling Hub',
        address: 'Zone 3, Bio-Sanitation Terminal, Electronic City, Bengaluru',
        contact_person: 'Mr. Pradeep Joshi (Operations Head)',
        contact_phone: '+91 98440 55662',
        latitude: 12.9620,
        longitude: 77.6015,
        license_number: 'CPCB-BMW-KA-2025-1190',
        capacity_tons_day: 10.0,
        status: 'Active'
      }
    ];

    for (const f of facilities) {
      const id = await getNextId('disposal_facilities');
      await DisposalFacility.create({ id, ...f });
    }
  }

  // 4. Seed Demo Users & Sample Collection Requests
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    console.log('Seeding Demo Accounts (Staff, Collector, Admin)...');
    const hashedPassword = await bcrypt.hash('Password@123', 10);

    // Staff User 1
    const staffUserId1 = await getNextId('users');
    await User.create({
      id: staffUserId1,
      username: 'staff_ananya',
      email: 'staff@hospital.com',
      password: hashedPassword,
      role: 'staff',
      full_name: 'Dr. Ananya Sharma',
      phone: '+91 98765 43210'
    });
    const staffId1 = await getNextId('staff');
    await Staff.create({
      id: staffId1,
      user_id: staffUserId1,
      staff_code: 'STF-EMR-01',
      department_id: 1,
      designation: 'Senior Nursing Officer',
      badge_number: 'NUR-4091'
    });

    // Staff User 2
    const staffUserId2 = await getNextId('users');
    await User.create({
      id: staffUserId2,
      username: 'nurse_kavita',
      email: 'nurse@hospital.com',
      password: hashedPassword,
      role: 'staff',
      full_name: 'Kavita Sundaram',
      phone: '+91 98765 43211'
    });
    const staffId2 = await getNextId('staff');
    await Staff.create({
      id: staffId2,
      user_id: staffUserId2,
      staff_code: 'STF-OT-02',
      department_id: 2,
      designation: 'Head OT Technician',
      badge_number: 'TECH-1102'
    });

    // Collector User 1
    const colUserId1 = await getNextId('users');
    await User.create({
      id: colUserId1,
      username: 'collector_rajesh',
      email: 'collector@hospital.com',
      password: hashedPassword,
      role: 'collector',
      full_name: 'Rajesh Kumar',
      phone: '+91 98765 43220'
    });
    const colId1 = await getNextId('collectors');
    await Collector.create({
      id: colId1,
      user_id: colUserId1,
      collector_code: 'COL-VAN-01',
      vehicle_number: 'KA-05-EB-4421',
      vehicle_type: 'GPS Bio-Waste Specialized Truck',
      assigned_zone: 'North & Central Campus',
      current_lat: 12.9722,
      current_lng: 77.5950,
      is_active: 1
    });

    // Collector User 2
    const colUserId2 = await getNextId('users');
    await User.create({
      id: colUserId2,
      username: 'collector_suresh',
      email: 'collector2@hospital.com',
      password: hashedPassword,
      role: 'collector',
      full_name: 'Suresh Goud',
      phone: '+91 98765 43221'
    });
    const colId2 = await getNextId('collectors');
    await Collector.create({
      id: colId2,
      user_id: colUserId2,
      collector_code: 'COL-VAN-02',
      vehicle_number: 'KA-04-MK-9912',
      vehicle_type: 'GPS Rapid Bio-Hazard Van',
      assigned_zone: 'South Campus & Labs',
      current_lat: 12.9710,
      current_lng: 77.5940,
      is_active: 1
    });

    // Admin User
    const adminUserId = await getNextId('users');
    await User.create({
      id: adminUserId,
      username: 'admin_vikram',
      email: 'admin@hospital.com',
      password: hashedPassword,
      role: 'admin',
      full_name: 'Dr. Vikram Malhotra (Medical Superintendent)',
      phone: '+91 98765 43230'
    });

    // Sample Collection Requests across the 8 stages
    console.log('Seeding Sample Collection Requests...');
    const sampleRequests = [
      {
        reqNum: 'BMW-2026-001',
        staffId: staffId1,
        deptId: 1,
        room: 'Trauma Resuscitation Bay 2',
        catId: 1,
        estKg: 4.8,
        actKg: 5.1,
        priority: 'Urgent',
        status: 'Completed',
        collectorId: colId1,
        facId: 1,
        lat: 12.97165,
        lng: 77.59462,
        address: 'Main Block A, Ground Floor, Emergency Trauma Bay 2',
        notes: 'Handover complete with thermal barcode verified at Apex CBWTF facility.'
      },
      {
        reqNum: 'BMW-2026-002',
        staffId: staffId2,
        deptId: 2,
        room: 'Cardiac Operation Theatre 3',
        catId: 3,
        estKg: 2.2,
        actKg: 2.4,
        priority: 'High',
        status: 'Handed Over to Authorized Treatment Facility',
        collectorId: colId1,
        facId: 1,
        lat: 12.97182,
        lng: 77.59481,
        address: 'Surgical Tower, 3rd Floor, Cardiac OT 3',
        notes: 'En route to shredder after autoclave verification at Apex CBWTF.'
      },
      {
        reqNum: 'BMW-2026-003',
        staffId: staffId1,
        deptId: 3,
        room: 'Bed 14 - Post Operative ICU',
        catId: 2,
        estKg: 6.5,
        actKg: 6.3,
        priority: 'Normal',
        status: 'Transported',
        collectorId: colId1,
        facId: 3,
        lat: 12.97155,
        lng: 77.59445,
        address: 'Critical Care Block, 2nd Floor, Bed 14',
        notes: 'Loaded into vehicle KA-05-EB-4421. GPS telemetry streaming live.'
      },
      {
        reqNum: 'BMW-2026-004',
        staffId: staffId2,
        deptId: 4,
        room: 'Histopathology Section Lab 4',
        catId: 4,
        estKg: 3.4,
        actKg: 3.5,
        priority: 'Normal',
        status: 'Waste Collected',
        collectorId: colId2,
        facId: 3,
        lat: 12.97192,
        lng: 77.59495,
        address: 'Diagnostic Wing, 1st Floor, Histopathology Lab 4',
        notes: 'Cardboard puncture-resistant box sealed with sodium hypochlorite label.'
      },
      {
        reqNum: 'BMW-2026-005',
        staffId: staffId1,
        deptId: 1,
        room: 'Minor Procedure Room 1',
        catId: 1,
        estKg: 3.1,
        actKg: null,
        priority: 'Urgent',
        status: 'Collection in Progress',
        collectorId: colId1,
        facId: 1,
        lat: 12.97160,
        lng: 77.59465,
        address: 'Main Block A, Ground Floor, Procedure Room 1',
        notes: 'Collector on-site scanning container RFID tag.'
      },
      {
        reqNum: 'BMW-2026-006',
        staffId: staffId2,
        deptId: 5,
        room: 'Chemotherapy Daycare Bay 5',
        catId: 1,
        estKg: 5.0,
        actKg: null,
        priority: 'High',
        status: 'Collector Assigned',
        collectorId: colId2,
        facId: 2,
        lat: 12.97135,
        lng: 77.59432,
        address: 'Super Specialty Wing, 4th Floor, Chemo Bay 5',
        notes: 'Assigned to collector Suresh Goud (Van KA-04-MK-9912).'
      },
      {
        reqNum: 'BMW-2026-007',
        staffId: staffId1,
        deptId: 2,
        room: 'Orthopedic OT 1',
        catId: 4,
        estKg: 4.2,
        actKg: null,
        priority: 'Normal',
        status: 'Request Accepted',
        collectorId: colId1,
        facId: 1,
        lat: 12.97185,
        lng: 77.59485,
        address: 'Surgical Tower, 3rd Floor, Ortho OT 1',
        notes: 'Request confirmed by dispatch coordinator.'
      },
      {
        reqNum: 'BMW-2026-008',
        staffId: staffId1,
        deptId: 3,
        room: 'Isolation Ward Room 204',
        catId: 2,
        estKg: 7.0,
        actKg: null,
        priority: 'Urgent',
        status: 'Request Submitted',
        collectorId: null,
        facId: null,
        lat: 12.97150,
        lng: 77.59440,
        address: 'Critical Care Block, 2nd Floor, Room 204',
        notes: 'Dialysis and urinary catheter bags packed in red biohazard bags awaiting pickup.'
      }
    ];

    for (const r of sampleRequests) {
      const reqId = await getNextId('collection_requests');
      await CollectionRequest.create({
        id: reqId,
        request_number: r.reqNum,
        staff_id: r.staffId,
        department_id: r.deptId,
        room_number: r.room,
        category_id: r.catId,
        estimated_weight_kg: r.estKg,
        actual_weight_kg: r.actKg,
        priority: r.priority,
        status: r.status,
        collector_id: r.collectorId,
        disposal_facility_id: r.facId,
        collection_lat: r.lat,
        collection_lng: r.lng,
        collection_address: r.address,
        handover_notes: r.notes
      });

      const recId = await getNextId('waste_records');
      await WasteRecord.create({
        id: recId,
        request_id: reqId,
        category_id: r.catId,
        quantity_kg: r.actKg || r.estKg,
        unit: 'kg',
        number_of_bags: 2,
        hazard_level: 'High',
        notes: r.notes,
        recorded_by_staff_id: r.staffId
      });

      const histId = await getNextId('collection_history');
      await CollectionHistory.create({
        id: histId,
        request_id: reqId,
        status: r.status,
        notes: `Workflow milestone: ${r.status}`,
        updated_by_user_id: staffUserId1,
        latitude: r.lat,
        longitude: r.lng
      });

      if (r.collectorId) {
        const gpsId = await getNextId('gps_locations');
        await GpsLocation.create({
          id: gpsId,
          request_id: reqId,
          collector_id: r.collectorId,
          latitude: r.lat + 0.001,
          longitude: r.lng + 0.001,
          accuracy: 5.0,
          location_type: 'collector_waypoint'
        });
      }
    }
  }

  console.log('MongoDB database initialization & seeding completed successfully.');
}

module.exports = {
  initDatabase,
  saveUploadedFile
};

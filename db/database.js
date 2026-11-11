const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure uploads directories exist
const uploadDirs = [
  path.join(__dirname, '..', 'uploads'),
  path.join(__dirname, '..', 'uploads', 'waste'),
  path.join(__dirname, '..', 'uploads', 'proofs')
];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const dbPath = path.join(dataDir, 'hospital_waste.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Helper for promise-based queries
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Initialize tables and seed data
async function initDatabase() {
  await run('PRAGMA foreign_keys = ON;');

  // 1. Users
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('staff', 'collector', 'admin')),
      full_name TEXT NOT NULL,
      phone TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Departments
  await run(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      floor TEXT,
      building TEXT,
      head_name TEXT,
      contact_number TEXT,
      default_lat REAL,
      default_lng REAL
    )
  `);

  // 3. Staff
  await run(`
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      staff_code TEXT UNIQUE NOT NULL,
      department_id INTEGER REFERENCES departments(id),
      designation TEXT,
      badge_number TEXT
    )
  `);

  // 4. Collectors
  await run(`
    CREATE TABLE IF NOT EXISTS collectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      collector_code TEXT UNIQUE NOT NULL,
      vehicle_number TEXT NOT NULL,
      vehicle_type TEXT DEFAULT 'Bio-Waste Van (GPS-Enabled)',
      assigned_zone TEXT,
      current_lat REAL,
      current_lng REAL,
      is_active INTEGER DEFAULT 1
    )
  `);

  // 5. Waste Categories
  await run(`
    CREATE TABLE IF NOT EXISTS waste_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      color TEXT NOT NULL,
      hex_color TEXT NOT NULL,
      badge_class TEXT,
      description TEXT NOT NULL,
      example_items TEXT NOT NULL,
      segregation_rules TEXT NOT NULL,
      handling_instructions TEXT NOT NULL,
      icon TEXT
    )
  `);

  // 6. Disposal Facilities
  await run(`
    CREATE TABLE IF NOT EXISTS disposal_facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      facility_type TEXT NOT NULL,
      address TEXT NOT NULL,
      contact_person TEXT,
      contact_phone TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      license_number TEXT,
      capacity_tons_day REAL,
      status TEXT DEFAULT 'Active'
    )
  `);

  // 7. Collection Requests (with 8-stage workflow)
  await run(`
    CREATE TABLE IF NOT EXISTS collection_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_number TEXT UNIQUE NOT NULL,
      staff_id INTEGER REFERENCES staff(id),
      department_id INTEGER REFERENCES departments(id),
      room_number TEXT NOT NULL,
      category_id INTEGER REFERENCES waste_categories(id),
      estimated_weight_kg REAL NOT NULL,
      actual_weight_kg REAL,
      waste_photo TEXT,
      proof_photo TEXT,
      priority TEXT DEFAULT 'Normal' CHECK(priority IN ('Normal', 'High', 'Urgent')),
      status TEXT NOT NULL DEFAULT 'Request Submitted',
      collector_id INTEGER REFERENCES collectors(id),
      disposal_facility_id INTEGER REFERENCES disposal_facilities(id),
      collection_lat REAL,
      collection_lng REAL,
      collection_address TEXT,
      collector_lat REAL,
      collector_lng REAL,
      handover_notes TEXT,
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 8. Waste Records
  await run(`
    CREATE TABLE IF NOT EXISTS waste_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER REFERENCES collection_requests(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES waste_categories(id),
      quantity_kg REAL NOT NULL,
      unit TEXT DEFAULT 'kg',
      number_of_bags INTEGER DEFAULT 1,
      photo_url TEXT,
      hazard_level TEXT DEFAULT 'High',
      notes TEXT,
      recorded_by_staff_id INTEGER REFERENCES staff(id),
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 9. GPS Locations
  await run(`
    CREATE TABLE IF NOT EXISTS gps_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER REFERENCES collection_requests(id),
      collector_id INTEGER REFERENCES collectors(id),
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      speed REAL,
      location_type TEXT DEFAULT 'collector_waypoint',
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 10. Collection History
  await run(`
    CREATE TABLE IF NOT EXISTS collection_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES collection_requests(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      notes TEXT,
      updated_by_user_id INTEGER REFERENCES users(id),
      latitude REAL,
      longitude REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 11. Reports
  await run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_code TEXT UNIQUE NOT NULL,
      report_title TEXT NOT NULL,
      report_type TEXT NOT NULL,
      filter_criteria TEXT,
      date_from DATE,
      date_to DATE,
      total_weight_kg REAL,
      total_requests INTEGER,
      generated_by_user_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await seedInitialData();
}

async function seedInitialData() {
  // Check if categories already seeded
  const catCount = await get('SELECT COUNT(*) as count FROM waste_categories');
  if (catCount.count === 0) {
    console.log('Seeding Waste Categories...');
    // 4 Biomedical Waste Categories + General Waste note
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
      await run(`
        INSERT INTO waste_categories (name, code, color, hex_color, badge_class, description, example_items, segregation_rules, handling_instructions, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [cat.name, cat.code, cat.color, cat.hex_color, cat.badge_class, cat.description, cat.example_items, cat.segregation_rules, cat.handling_instructions, cat.icon]);
    }
  }

  // Check Departments
  const deptCount = await get('SELECT COUNT(*) as count FROM departments');
  if (deptCount.count === 0) {
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
      await run(`
        INSERT INTO departments (name, code, floor, building, head_name, contact_number, default_lat, default_lng)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [d.name, d.code, d.floor, d.building, d.head_name, d.contact_number, d.default_lat, d.default_lng]);
    }
  }

  // Check Disposal Facilities
  const facilityCount = await get('SELECT COUNT(*) as count FROM disposal_facilities');
  if (facilityCount.count === 0) {
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
      await run(`
        INSERT INTO disposal_facilities (name, code, facility_type, address, contact_person, contact_phone, latitude, longitude, license_number, capacity_tons_day, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [f.name, f.code, f.facility_type, f.address, f.contact_person, f.contact_phone, f.latitude, f.longitude, f.license_number, f.capacity_tons_day, f.status]);
    }
  }

  // Check Users (Staff, Collector, Admin)
  const userCount = await get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    console.log('Seeding Demo Accounts (Staff, Collector, Admin)...');
    const defaultPassword = 'Password@123';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    // 1. Staff User 1
    const staffUserRes = await run(`
      INSERT INTO users (username, email, password, role, full_name, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['staff_ananya', 'staff@hospital.com', hashedPassword, 'staff', 'Dr. Ananya Sharma', '+91 98765 43210']);
    
    await run(`
      INSERT INTO staff (user_id, staff_code, department_id, designation, badge_number)
      VALUES (?, ?, ?, ?, ?)
    `, [staffUserRes.id, 'STF-EMR-01', 1, 'Senior Nursing Officer', 'NUR-4091']);

    // Staff User 2 (OT Specialist)
    const staffUserRes2 = await run(`
      INSERT INTO users (username, email, password, role, full_name, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['nurse_kavita', 'nurse@hospital.com', hashedPassword, 'staff', 'Kavita Sundaram', '+91 98765 43211']);
    
    await run(`
      INSERT INTO staff (user_id, staff_code, department_id, designation, badge_number)
      VALUES (?, ?, ?, ?, ?)
    `, [staffUserRes2.id, 'STF-OT-02', 2, 'Head OT Technician', 'TECH-1102']);

    // 2. Collector User 1
    const collectorUserRes = await run(`
      INSERT INTO users (username, email, password, role, full_name, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['collector_rajesh', 'collector@hospital.com', hashedPassword, 'collector', 'Rajesh Kumar', '+91 98765 43220']);

    await run(`
      INSERT INTO collectors (user_id, collector_code, vehicle_number, vehicle_type, assigned_zone, current_lat, current_lng, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [collectorUserRes.id, 'COL-VAN-01', 'KA-05-EB-4421', 'GPS Bio-Waste Specialized Truck', 'North & Central Campus', 12.9722, 77.5950, 1]);

    // Collector User 2
    const collectorUserRes2 = await run(`
      INSERT INTO users (username, email, password, role, full_name, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['collector_suresh', 'collector2@hospital.com', hashedPassword, 'collector', 'Suresh Goud', '+91 98765 43221']);

    await run(`
      INSERT INTO collectors (user_id, collector_code, vehicle_number, vehicle_type, assigned_zone, current_lat, current_lng, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [collectorUserRes2.id, 'COL-VAN-02', 'KA-04-MK-9912', 'GPS Rapid Bio-Hazard Van', 'South Campus & Labs', 12.9710, 77.5940, 1]);

    // 3. Admin User
    await run(`
      INSERT INTO users (username, email, password, role, full_name, phone)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['admin_vikram', 'admin@hospital.com', hashedPassword, 'admin', 'Dr. Vikram Malhotra (Medical Superintendent)', '+91 98765 43230']);

    // Seed Sample Collection Requests across the 8 stages
    console.log('Seeding Sample Collection Requests...');
    const sampleRequests = [
      {
        reqNum: 'BMW-2026-001',
        staffId: 1,
        deptId: 1, // Emergency
        room: 'Trauma Resuscitation Bay 2',
        catId: 1, // Yellow (Infectious)
        estKg: 4.8,
        actKg: 5.1,
        priority: 'Urgent',
        status: 'Completed',
        collectorId: 1,
        facId: 1,
        lat: 12.97165,
        lng: 77.59462,
        address: 'Main Block A, Ground Floor, Emergency Trauma Bay 2',
        notes: 'Handover complete with thermal barcode verified at Apex CBWTF facility.'
      },
      {
        reqNum: 'BMW-2026-002',
        staffId: 2,
        deptId: 2, // OT
        room: 'Cardiac Operation Theatre 3',
        catId: 3, // White (Sharps)
        estKg: 2.2,
        actKg: 2.4,
        priority: 'High',
        status: 'Handed Over to Authorized Treatment Facility',
        collectorId: 1,
        facId: 1,
        lat: 12.97182,
        lng: 77.59481,
        address: 'Surgical Tower, 3rd Floor, Cardiac OT 3',
        notes: 'En route to shredder after autoclave verification at Apex CBWTF.'
      },
      {
        reqNum: 'BMW-2026-003',
        staffId: 1,
        deptId: 3, // ICU
        room: 'Bed 14 - Post Operative ICU',
        catId: 2, // Red (Plastic)
        estKg: 6.5,
        actKg: 6.3,
        priority: 'Normal',
        status: 'Transported',
        collectorId: 1,
        facId: 3,
        lat: 12.97155,
        lng: 77.59445,
        address: 'Critical Care Block, 2nd Floor, Bed 14',
        notes: 'Loaded into vehicle KA-05-EB-4421. GPS telemetry streaming live.'
      },
      {
        reqNum: 'BMW-2026-004',
        staffId: 2,
        deptId: 4, // Pathology
        room: 'Histopathology Section Lab 4',
        catId: 4, // Blue (Glass)
        estKg: 3.4,
        actKg: 3.5,
        priority: 'Normal',
        status: 'Waste Collected',
        collectorId: 2,
        facId: 3,
        lat: 12.97192,
        lng: 77.59495,
        address: 'Diagnostic Wing, 1st Floor, Histopathology Lab 4',
        notes: 'Cardboard puncture-resistant box sealed with sodium hypochlorite label.'
      },
      {
        reqNum: 'BMW-2026-005',
        staffId: 1,
        deptId: 1, // Emergency
        room: 'Minor Procedure Room 1',
        catId: 1, // Yellow
        estKg: 3.1,
        actKg: null,
        priority: 'Urgent',
        status: 'Collection in Progress',
        collectorId: 1,
        facId: 1,
        lat: 12.97160,
        lng: 77.59465,
        address: 'Main Block A, Ground Floor, Procedure Room 1',
        notes: 'Collector on-site scanning container RFID tag.'
      },
      {
        reqNum: 'BMW-2026-006',
        staffId: 2,
        deptId: 5, // Oncology
        room: 'Chemotherapy Daycare Bay 5',
        catId: 1, // Yellow (Cytotoxic)
        estKg: 5.0,
        actKg: null,
        priority: 'High',
        status: 'Collector Assigned',
        collectorId: 2,
        facId: 2,
        lat: 12.97135,
        lng: 77.59432,
        address: 'Super Specialty Wing, 4th Floor, Chemo Bay 5',
        notes: 'Assigned to collector Rajesh Kumar (Van KA-05-EB-4421).'
      },
      {
        reqNum: 'BMW-2026-007',
        staffId: 1,
        deptId: 2, // OT
        room: 'Orthopedic OT 1',
        catId: 4, // Blue (Implants)
        estKg: 4.2,
        actKg: null,
        priority: 'Normal',
        status: 'Request Accepted',
        collectorId: 1,
        facId: 1,
        lat: 12.97185,
        lng: 77.59485,
        address: 'Surgical Tower, 3rd Floor, Ortho OT 1',
        notes: 'Request confirmed by dispatch coordinator.'
      },
      {
        reqNum: 'BMW-2026-008',
        staffId: 1,
        deptId: 3, // ICU
        room: 'Isolation Ward Room 204',
        catId: 2, // Red
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
      const res = await run(`
        INSERT INTO collection_requests (
          request_number, staff_id, department_id, room_number, category_id,
          estimated_weight_kg, actual_weight_kg, priority, status, collector_id,
          disposal_facility_id, collection_lat, collection_lng, collection_address,
          handover_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        r.reqNum, r.staffId, r.deptId, r.room, r.catId,
        r.estKg, r.actKg, r.priority, r.status, r.collectorId,
        r.facId, r.lat, r.lng, r.address, r.notes
      ]);

      // Waste record
      await run(`
        INSERT INTO waste_records (request_id, category_id, quantity_kg, unit, number_of_bags, hazard_level, notes, recorded_by_staff_id)
        VALUES (?, ?, ?, 'kg', 2, 'High', ?, ?)
      `, [res.id, r.catId, r.actKg || r.estKg, r.notes, r.staffId]);

      // History
      await run(`
        INSERT INTO collection_history (request_id, status, notes, updated_by_user_id, latitude, longitude)
        VALUES (?, ?, ?, 1, ?, ?)
      `, [res.id, r.status, `Workflow milestone: ${r.status}`, r.lat, r.lng]);

      // GPS trail
      if (r.collectorId) {
        await run(`
          INSERT INTO gps_locations (request_id, collector_id, latitude, longitude, accuracy, location_type)
          VALUES (?, ?, ?, ?, 5.0, 'collector_waypoint')
        `, [res.id, r.collectorId, r.lat + 0.001, r.lng + 0.001]);
      }
    }
  }

  console.log('Database initialization & seeding completed successfully.');
}

module.exports = {
  db,
  run,
  get,
  all,
  initDatabase
};


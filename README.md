# Smart Hospital Waste Management System

A modern, professional, and fully functional healthcare platform designed to **collect, segregate, monitor, and track hospital biomedical waste** efficiently. The system classifies hospital waste into four biomedical waste categories using colour-coded bins, records waste collection locations with real device GPS, tracks collection vehicle telemetry, provides interactive map routing to Central Bio-Medical Waste Treatment Facilities (CBWTF), and generates statutory PDF and Excel manifests.

---

## 🌟 Key Features

### 1. Four Colour-Coded Waste Segregation Bins
- **YELLOW (Infectious & Pathological Waste)**:
  - Human anatomical waste, tissues, organs, placenta, biopsy samples
  - Blood-contaminated cotton, dressings, plaster casts
  - Expired pharmaceuticals, cytotoxic medicines, discard vaccines
  - Laboratory microbiology and pathology culture specimens
  - *Disposal*: Non-chlorinated yellow bags &rarr; High-temperature Incineration / Plasma Pyrolysis.
- **RED (Contaminated Recyclable Plastics)**:
  - Disposable gloves, examination gloves
  - IV drip bottles and intravenous tubing
  - Urinary bags, catheters, dialysis consumables, vacutainers
  - *Disposal*: Non-chlorinated red bags &rarr; Autoclaving / Microwaving followed by shredding.
- **WHITE TRANSLUCENT (Sharps & Contaminated Metals)**:
  - Hypodermic needles, scalpel blades, suture needles, trocars, lancets
  - *Disposal*: Rigid puncture-proof, tamper-proof translucent sharps box &rarr; Autoclaving & Metal Encapsulation.
- **BLUE (Glassware & Metallic Implants)**:
  - Medicine glass bottles, vials, ampoules
  - Orthopedic metallic implants, dental prosthetics, stainless steel pins
  - *Disposal*: Puncture-resistant cardboard box / container &rarr; Sodium Hypochlorite disinfection / Recycling.
- **Strict Municipal Separation**: Food waste (Green bin) and dry cardboard/paper (Black bin) are kept strictly separate from biomedical categories.

---

### 2. Role-Based Login System & Portals
- **Hospital Staff Dashboard** (`/staff`):
  - **Mandatory Image-First Policy**: Upload or capture a waste photograph before colour-coded bin segregation unlocks
  - Select from 4 color-coded waste bins with instant guidelines and sample images
  - Upload waste evidence photographs (JPEG/PNG/WebP)
  - Select department and room / OT / bed number
  - Enter estimated weight (kg) and number of bags
  - Capture real device GPS coordinates (`navigator.geolocation`)
  - Submit collection request and track its live 8-stage lifecycle
  - View previous collection request history with filters
- **Waste Collector Portal** (`/collector`):
  - View incoming requests on the collection radar
  - Accept or decline collection requests
  - View department location and open GPS navigation route
  - Advance status step-by-step through the 8 stages
  - Upload collection proof photograph and record verified actual scale weight
  - Log handover to authorized Central Bio-Medical Waste Treatment Facility (CBWTF)
  - Transmit live GPS telemetry
- **Administrator Console** (`/admin`):
  - Live KPI dashboard (Total Waste Collected kg, Pending Pickups, Completed Cycles, Active Collectors)
  - Interactive **Chart.js** analytics (Category breakdown doughnut, 7-day collection trends, department generation)
  - Interactive **Leaflet.js** live GPS tracking map showing all collection points, active collector vans, and CBWTF facilities
  - Hospital-wide requests monitor
  - User management (Create Staff / Collector accounts, toggle active/inactive status)
  - Department and Treatment Facility management
  - Comprehensive reporting module with **Excel (.xlsx)** and official **PDF Manifest** download

---

### 3. Eight-Stage Collection Lifecycle Workflow
1. **Request Submitted**: Created by clinical staff with photo, weight, and room GPS.
2. **Request Accepted**: Dispatch confirms the pickup request.
3. **Collector Assigned**: Assigned to a licensed biohazard collector with vehicle details.
4. **Collection in Progress**: Collector arrives at the department with a safety cart.
5. **Waste Collected**: Container sealed, weight verified on scale, and proof photo uploaded.
6. **Transported**: Loaded into GPS-monitored vehicle for transit.
7. **Handed Over to Authorized Treatment Facility**: Received at CBWTF with electronic manifest.
8. **Completed**: Final treatment certified; audit trail permanently sealed.

---

### 4. Interactive GPS & Route Tracking
- Uses **OpenStreetMap** with **Leaflet.js**.
- High-accuracy HTML5 `navigator.geolocation` browser sensor integration.
- Color-coded map markers matching each waste bin.
- Navigation route polylines connecting hospital wards, collector vehicles, and treatment hubs.

---

### 5. Statutory Reports & Manifests
- **Excel (.xlsx)**: Exported via SheetJS with full manifest fields, staff codes, collector IDs, vehicle numbers, GPS coordinates, and handover notes.
- **PDF Manifest**: Formatted official biomedical waste manifest using `jsPDF` and `autoTable` with digital verification stamps and summary statistics.
- Filters: Daily, Weekly, Monthly, Category-wise, Department-wise, Staff-wise, Collector-wise.

---

## 🔑 Default Demo Accounts

| Portal | Email / Identifier | Password | Name / Details |
| :--- | :--- | :--- | :--- |
| **Hospital Staff** | `staff@hospital.com` | `Password@123` | Dr. Ananya Sharma (Emergency & Trauma Care) |
| **Waste Collector** | `collector@hospital.com` | `Password@123` | Rajesh Kumar (Van KA-05-EB-4421) |
| **Administrator** | `admin@hospital.com` | `Password@123` | Dr. Vikram Malhotra (Medical Superintendent) |

> 💡 **Tip**: On the landing page (`/`), you can also click the **"Instant Sign In (Demo)"** button on any of the 3 portal cards to log in instantly without typing!

---

## 🗄️ Database Architecture (MongoDB / Mongoose)

The system automatically initializes and seeds MongoDB collections (`db/models.js` & `db/database.js`) containing all 11 core entities plus persistent uploaded image storage:
1. `users`: Credentials, hashed passwords (`bcryptjs`), roles (`staff`, `collector`, `admin`), profile data.
2. `staff`: Staff codes, department reference, designation, badge number.
3. `collectors`: Collector codes, vehicle numbers, vehicle types, assigned zone, live lat/lng, active state.
4. `departments`: Hospital wards/units, floor, building, department head, default GPS.
5. `waste_categories`: Yellow, Red, White, Blue categories, hex colors, segregation rules, instructions.
6. `waste_records`: Quantity in kg, number of bags, photo URLs, hazard level, timestamps.
7. `collection_requests`: Unique tracking numbers, department, room, estimated & actual weights, photos, priority, status (8 stages), collector and facility relations, GPS coordinates.
8. `gps_locations`: Waypoint coordinates, collector telemetry, accuracy, speeds, timestamps.
9. `collection_history`: Complete audit log with status transitions, actor IDs, notes, and coordinates.
10. `reports`: Generated manifest records, filters, summary metadata, timestamps.
11. `disposal_facilities`: Licensed CBWTF facilities, addresses, contacts, licenses, capacities.
12. `uploaded_files`: Uploaded waste and proof photographs stored persistently in MongoDB.

---

## 🚀 How to Run & Host (Vercel + Render + MongoDB Atlas)

### 1. Prerequisites
- **Node.js** (v20.17.0 or higher; tested on Node.js v24)
- **MongoDB Atlas** free cluster URI (or local MongoDB instance)

### 2. Local Setup
1. Copy `.env.example` to `.env` and set `MONGODB_URI` to your MongoDB Atlas connection string.
2. Install dependencies and start the server:
```bash
npm install
node server.js
```

### 3. Open Locally in Browser
- **Landing Page**: [http://localhost:3000](http://localhost:3000)
- **Hospital Staff Dashboard**: [http://localhost:3000/staff](http://localhost:3000/staff)
- **Waste Collector Portal**: [http://localhost:3000/collector](http://localhost:3000/collector)
- **Administrator Console**: [http://localhost:3000/admin](http://localhost:3000/admin)
- **API Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

### 4. Production Deployment (MongoDB Atlas + Render Backend + Vercel Frontend)
1. **MongoDB Atlas**: Create a free cluster, database user, allow network access (`0.0.0.0/0`), and copy your `MONGODB_URI`.
2. **Render (Backend)**: Deploy this repository using `render.yaml` (or Web Service: `npm install` / `npm start`) and add `MONGODB_URI` in Render Environment Variables.
3. **Vercel (Frontend)**: Set `RENDER_BACKEND_URL` in `public/js/config.js` to your Render backend URL, push to GitHub, and deploy on Vercel (`vercel.json` serves `public/` with `/staff`, `/collector`, and `/admin` routes).


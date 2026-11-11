const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const userSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  username: { type: String, unique: true, required: true, trim: true },
  email: { type: String, unique: true, required: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, required: true, enum: ['staff', 'collector', 'admin'] },
  full_name: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  status: { type: String, default: 'active', enum: ['active', 'inactive'] },
  created_at: { type: Date, default: Date.now }
});

const departmentSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  name: { type: String, required: true },
  code: { type: String, unique: true, required: true },
  floor: { type: String, default: '1st Floor' },
  building: { type: String, default: 'Main Block' },
  head_name: { type: String, default: '' },
  contact_number: { type: String, default: '' },
  default_lat: { type: Number, default: 12.9716 },
  default_lng: { type: Number, default: 77.5946 }
});

const staffSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  user_id: { type: Number, required: true, index: true },
  staff_code: { type: String, unique: true, required: true },
  department_id: { type: Number, default: 1 },
  designation: { type: String, default: 'Nursing Officer' },
  badge_number: { type: String, default: '' }
});

const collectorSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  user_id: { type: Number, required: true, index: true },
  collector_code: { type: String, unique: true, required: true },
  vehicle_number: { type: String, required: true },
  vehicle_type: { type: String, default: 'Bio-Waste Van (GPS-Enabled)' },
  assigned_zone: { type: String, default: 'Hospital Campus' },
  current_lat: { type: Number, default: 12.9716 },
  current_lng: { type: Number, default: 77.5946 },
  is_active: { type: Number, default: 1 }
});

const wasteCategorySchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  name: { type: String, required: true },
  code: { type: String, unique: true, required: true },
  color: { type: String, required: true },
  hex_color: { type: String, required: true },
  badge_class: { type: String, default: '' },
  description: { type: String, required: true },
  example_items: { type: String, required: true },
  segregation_rules: { type: String, required: true },
  handling_instructions: { type: String, required: true },
  icon: { type: String, default: 'biohazard' }
});

const disposalFacilitySchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  name: { type: String, required: true },
  code: { type: String, unique: true, required: true },
  facility_type: { type: String, required: true },
  address: { type: String, default: '' },
  contact_person: { type: String, default: '' },
  contact_phone: { type: String, default: '' },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  license_number: { type: String, default: '' },
  capacity_tons_day: { type: Number, default: 10.0 },
  status: { type: String, default: 'Active' }
});

const collectionRequestSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  request_number: { type: String, unique: true, required: true },
  staff_id: { type: Number, index: true },
  department_id: { type: Number, index: true },
  room_number: { type: String, required: true },
  category_id: { type: Number, index: true },
  estimated_weight_kg: { type: Number, required: true },
  actual_weight_kg: { type: Number, default: null },
  waste_photo: { type: String, default: null },
  proof_photo: { type: String, default: null },
  priority: { type: String, default: 'Normal', enum: ['Normal', 'High', 'Urgent'] },
  status: { type: String, default: 'Request Submitted', index: true },
  collector_id: { type: Number, default: null, index: true },
  disposal_facility_id: { type: Number, default: null },
  collection_lat: { type: Number },
  collection_lng: { type: Number },
  collection_address: { type: String, default: 'Hospital Department Location' },
  collector_lat: { type: Number, default: null },
  collector_lng: { type: Number, default: null },
  handover_notes: { type: String, default: '' },
  rejection_reason: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

const wasteRecordSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  request_id: { type: Number, index: true },
  category_id: { type: Number },
  quantity_kg: { type: Number, required: true },
  unit: { type: String, default: 'kg' },
  number_of_bags: { type: Number, default: 1 },
  photo_url: { type: String, default: null },
  hazard_level: { type: String, default: 'High' },
  notes: { type: String, default: '' },
  recorded_by_staff_id: { type: Number },
  recorded_at: { type: Date, default: Date.now }
});

const gpsLocationSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  request_id: { type: Number, default: null, index: true },
  collector_id: { type: Number, default: null },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracy: { type: Number, default: null },
  speed: { type: Number, default: null },
  location_type: { type: String, default: 'collector_waypoint' },
  recorded_at: { type: Date, default: Date.now }
});

const collectionHistorySchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  request_id: { type: Number, required: true, index: true },
  status: { type: String, required: true },
  notes: { type: String, default: '' },
  updated_by_user_id: { type: Number },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  created_at: { type: Date, default: Date.now }
});

const reportSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  report_code: { type: String, unique: true, required: true },
  report_title: { type: String, required: true },
  report_type: { type: String, required: true },
  filter_criteria: { type: String, default: '' },
  date_from: { type: String, default: '' },
  date_to: { type: String, default: '' },
  total_weight_kg: { type: Number, default: 0 },
  total_requests: { type: Number, default: 0 },
  generated_by_user_id: { type: Number },
  created_at: { type: Date, default: Date.now }
});

const uploadedFileSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true, index: true },
  filename: { type: String, required: true },
  mimetype: { type: String, required: true },
  data: { type: Buffer, required: true },
  size: { type: Number, required: true },
  folder: { type: String, default: 'waste' },
  created_at: { type: Date, default: Date.now }
});

const Counter = mongoose.model('Counter', counterSchema);
const User = mongoose.model('User', userSchema);
const Department = mongoose.model('Department', departmentSchema);
const Staff = mongoose.model('Staff', staffSchema);
const Collector = mongoose.model('Collector', collectorSchema);
const WasteCategory = mongoose.model('WasteCategory', wasteCategorySchema);
const DisposalFacility = mongoose.model('DisposalFacility', disposalFacilitySchema);
const CollectionRequest = mongoose.model('CollectionRequest', collectionRequestSchema);
const WasteRecord = mongoose.model('WasteRecord', wasteRecordSchema);
const GpsLocation = mongoose.model('GpsLocation', gpsLocationSchema);
const CollectionHistory = mongoose.model('CollectionHistory', collectionHistorySchema);
const Report = mongoose.model('Report', reportSchema);
const UploadedFile = mongoose.model('UploadedFile', uploadedFileSchema);

/** Atomically generates the next sequential integer ID for a collection. */
async function getNextId(sequenceName) {
  const counter = await Counter.findByIdAndUpdate(
    sequenceName,
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return counter.seq;
}

module.exports = {
  Counter,
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
  Report,
  UploadedFile,
  getNextId
};


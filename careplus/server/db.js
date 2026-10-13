const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const SEED = require("../shared/data.js");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "careplus.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL CHECK (role IN ('customer','phc','stockholder')),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    licence TEXT NOT NULL DEFAULT '',
    ref_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS medicines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    form TEXT NOT NULL,
    unit TEXT NOT NULL,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS centres (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    distance_km REAL NOT NULL DEFAULT 0,
    phone TEXT NOT NULL DEFAULT '',
    incharge TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    rating REAL NOT NULL DEFAULT 0,
    lead_time_days INTEGER NOT NULL DEFAULT 3
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS stock (
    centre_id TEXT NOT NULL,
    med_id TEXT NOT NULL,
    qty INTEGER NOT NULL DEFAULT 0,
    daily REAL NOT NULL DEFAULT 0,
    safety INTEGER NOT NULL DEFAULT 0,
    lead INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (centre_id, med_id)
  );

  CREATE TABLE IF NOT EXISTS customer_requests (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    centre_id TEXT NOT NULL,
    med_id TEXT NOT NULL,
    qty INTEGER NOT NULL,
    prescription INTEGER NOT NULL DEFAULT 0,
    prescription_name TEXT NOT NULL DEFAULT '',
    home_address TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT '',
    response_note TEXT NOT NULL DEFAULT '',
    events TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS supply_requests (
    id TEXT PRIMARY KEY,
    centre_id TEXT NOT NULL,
    supplier_id TEXT NOT NULL,
    med_id TEXT NOT NULL,
    qty INTEGER NOT NULL,
    accepted_qty INTEGER NOT NULL DEFAULT 0,
    dispatched_qty INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    eta TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    events TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    med_id TEXT NOT NULL,
    donor_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    qty INTEGER NOT NULL,
    approved_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

`);
db.exec("DROP TABLE IF EXISTS admin_accounts");

const DEMO_USERS = [
  { role: "customer", username: "ravi", password: "care123", id: "cust1", name: "Ravi Kumar" },
  { role: "customer", username: "meera", password: "care123", id: "cust2", name: "Meera Joseph" },
  { role: "customer", username: "arun", password: "care123", id: "cust3", name: "Arun Das" },
  { role: "phc", username: "greenvalley", password: "phc123", id: "C1", name: "Green Valley PHC" },
  { role: "phc", username: "riverside", password: "phc123", id: "C2", name: "Riverside PHC" },
  { role: "phc", username: "hilltop", password: "phc123", id: "C3", name: "Hilltop PHC" },
  { role: "phc", username: "sunrise", password: "phc123", id: "C4", name: "Sunrise PHC" },
  { role: "stockholder", username: "medidist", password: "sup123", id: "S1", name: "MediDist Ltd" },
  { role: "stockholder", username: "pharmalink", password: "sup123", id: "S2", name: "PharmaLink Distributors" },
  { role: "stockholder", username: "healthcore", password: "sup123", id: "S3", name: "HealthCore Supplies" }
];

function seed() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM medicines").get().n;
  if (count > 0) return false;

  const insMed = db.prepare("INSERT INTO medicines (id,name,form,unit,category) VALUES (?,?,?,?,?)");
  SEED.medicines.forEach(function (m) { insMed.run(m.id, m.name, m.form, m.unit, m.category); });

  const insCentre = db.prepare("INSERT INTO centres (id,name,area,distance_km,phone,incharge) VALUES (?,?,?,?,?,?)");
  SEED.centres.forEach(function (c) { insCentre.run(c.id, c.name, c.area, c.distanceKm, c.phone, c.incharge); });

  const insSup = db.prepare("INSERT INTO suppliers (id,name,contact,rating,lead_time_days) VALUES (?,?,?,?,?)");
  SEED.suppliers.forEach(function (s) { insSup.run(s.id, s.name, s.contact, s.rating, s.leadTimeDays); });

  const insCust = db.prepare("INSERT INTO customers (id,name,phone,area) VALUES (?,?,?,?)");
  SEED.customers.forEach(function (c) { insCust.run(c.id, c.name, c.phone, c.area); });

  const insStock = db.prepare("INSERT INTO stock (centre_id,med_id,qty,daily,safety,lead) VALUES (?,?,?,?,?,?)");
  Object.keys(SEED.stock).forEach(function (cid) {
    Object.keys(SEED.stock[cid]).forEach(function (mid) {
      const e = SEED.stock[cid][mid];
      insStock.run(cid, mid, e.qty, e.daily, e.safety, e.lead);
    });
  });

  const insReq = db.prepare(`INSERT INTO customer_requests
    (id,customer_id,centre_id,med_id,qty,prescription,prescription_name,status,created_at,response_note,events)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  SEED.customerRequests.forEach(function (r) {
    insReq.run(r.id, r.customerId, r.centreId, r.medId, r.qty, r.prescription ? 1 : 0,
      r.prescriptionName || "", r.status, r.createdAt, r.responseNote || "", JSON.stringify(r.events || []));
  });

  const insSupply = db.prepare(`INSERT INTO supply_requests
    (id,centre_id,supplier_id,med_id,qty,accepted_qty,dispatched_qty,status,eta,note,created_at,events)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  SEED.supplyRequests.forEach(function (r) {
    insSupply.run(r.id, r.centreId, r.supplierId, r.medId, r.qty, r.acceptedQty || 0, r.dispatchedQty || 0,
      r.status, r.eta || "", r.note || "", r.createdAt || new Date().toISOString(), JSON.stringify(r.events || []));
  });

  return true;
}

function seedUsers() {
  const insUser = db.prepare(`INSERT OR IGNORE INTO users
    (role,username,password_hash,name,ref_id) VALUES (?,?,?,?,?)`);
  DEMO_USERS.forEach(function (u) {
    insUser.run(u.role, u.username, bcrypt.hashSync(u.password, 10), u.name, u.id);
  });
}

const didSeed = seed();
seedUsers();

if (didSeed) console.log("CarePlus: seeded careplus.db with demo data");

module.exports = db;

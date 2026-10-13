const path = require("node:path");
const http = require("node:http");
const express = require("express");
const bcrypt = require("bcryptjs");

const db = require("./db");
const S = require("./state");
const { signToken, requireAuth, requireRole } = require("./auth");

const app = express();
app.use(express.json());

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LICENSE_RE = /^[A-Za-z0-9][A-Za-z0-9\-\/ ]{4,}$/;

function publicUser(u) {
  return { role: u.role, id: u.ref_id, name: u.name, username: u.username, licence: u.licence };
}

/* ---------------- auth ---------------- */
app.post("/api/auth/login", function (req, res) {
  const b = req.body || {};
  const username = String(b.username || "").trim().toLowerCase();
  const password = String(b.password || "");
  const role = b.role;
  if (!username || !password) return res.status(400).json({ error: "Username and password are required" });

  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!u || (role && u.role !== role) || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials for the " + (role || "selected") + " role" });
  }
  res.json({ token: signToken(u), user: publicUser(u) });
});

app.post("/api/auth/register", function (req, res) {
  const b = req.body || {};
  const role = b.role;
  if (role !== "phc" && role !== "stockholder") {
    return res.status(400).json({ error: "Registration is only available for pharmacists and stockholders" });
  }
  const name = String(b.name || "").trim();
  const shop = String(b.shop || "").trim();
  const licence = String(b.licence || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const phone = String(b.phone || "").trim();
  const password = String(b.password || "");
  const refId = String(b.id || "").trim();

  if (!name || !shop || !licence || !email || !phone || !password || !refId) {
    return res.status(400).json({ error: "Please fill in all fields" });
  }
  if (!LICENSE_RE.test(licence)) return res.status(400).json({ error: "Enter a valid shop license number" });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(email);
  if (exists) return res.status(409).json({ error: "An account with this email already exists" });

  const info = db.prepare(`INSERT INTO users (role,username,password_hash,name,email,phone,licence,ref_id)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(role, email, bcrypt.hashSync(password, 10), shop, email, phone, licence.toUpperCase(), refId);

  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(u), user: publicUser(u) });
});

app.get("/api/auth/me", requireAuth, function (req, res) {
  res.json({ user: req.user });
});

/* ---------------- state ---------------- */
function scoped(user) {
  return S.scopeState(S.loadState(), user);
}

app.get("/api/state", requireAuth, function (req, res) {
  res.json({ state: scoped(req.user) });
});

/* ---------------- customer ---------------- */
app.post("/api/customer/requests", requireAuth, requireRole("customer"), function (req, res) {
  const b = req.body || {};
  if (!b.centreId || !b.medId || !(Number(b.qty) > 0)) {
    return res.status(400).json({ error: "centreId, medId and a positive qty are required" });
  }
  const id = S.addCustomerRequest({
    customerId: req.user.id,
    centreId: b.centreId,
    medId: b.medId,
    qty: Math.round(Number(b.qty)),
    prescription: !!b.prescription,
    prescriptionName: b.prescriptionName || "",
    homeAddress: b.homeAddress || "",
    note: b.note || ""
  });
  res.status(201).json({ id: id, state: scoped(req.user) });
});

/* ---------------- PHC ---------------- */
app.post("/api/phc/customer-requests/:id/respond", requireAuth, requireRole("phc"), function (req, res) {
  const b = req.body || {};
  if (["accepted", "partial", "out_of_stock"].indexOf(b.decision) === -1) {
    return res.status(400).json({ error: "decision must be accepted, partial or out_of_stock" });
  }
  const ok = S.respondCustomerRequest(req.params.id, {
    decision: b.decision, qty: Number(b.qty) || 0, note: b.note || ""
  });
  if (!ok) return res.status(404).json({ error: "Request not found" });
  res.json({ state: scoped(req.user) });
});

app.post("/api/phc/transfers/approve", requireAuth, requireRole("phc"), function (req, res) {
  const b = req.body || {};
  const ok = S.approveTransfer({
    donorId: b.donorId, receiverId: b.receiverId, medId: b.medId, qty: Number(b.qty) || 0
  });
  if (!ok) return res.status(400).json({ error: "Transfer could not be applied" });
  res.json({ state: scoped(req.user) });
});

app.post("/api/phc/supply-requests", requireAuth, requireRole("phc"), function (req, res) {
  const b = req.body || {};
  if (!b.medId || !b.supplierId || !(Number(b.qty) > 0)) {
    return res.status(400).json({ error: "medId, supplierId and a positive qty are required" });
  }
  const id = S.addSupplyRequest({
    centreId: req.user.id, medId: b.medId, supplierId: b.supplierId,
    qty: Math.round(Number(b.qty)), note: b.note || ""
  });
  res.status(201).json({ id: id, state: scoped(req.user) });
});

/* ---------------- stockholder ---------------- */
app.post("/api/supply-requests/:id/action", requireAuth, requireRole("stockholder"), function (req, res) {
  const b = req.body || {};
  const allowed = ["accept", "partial", "reject", "dispatch", "receive"];
  if (allowed.indexOf(b.action) === -1) {
    return res.status(400).json({ error: "action must be one of " + allowed.join(", ") });
  }
  const row = db.prepare("SELECT supplier_id FROM supply_requests WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Supply request not found" });
  if (row.supplier_id !== req.user.id) return res.status(403).json({ error: "Not your assigned request" });

  S.supplyAction(req.params.id, { action: b.action, qty: b.qty, eta: b.eta, reason: b.reason });
  res.json({ state: scoped(req.user) });
});

/* ---------------- static site ---------------- */
const CLIENT_DIR = path.join(__dirname, "..", "client");
const SHARED_DIR = path.join(__dirname, "..", "shared");
app.use("/shared", express.static(SHARED_DIR));
app.use(express.static(CLIENT_DIR));
app.get("/", function (req, res) { res.sendFile(path.join(CLIENT_DIR, "index.html")); });

app.use("/api", function (req, res) { res.status(404).json({ error: "Not found" }); });
app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
http.createServer(app).listen(PORT, function () {
  console.log("CarePlus server running at http://localhost:" + PORT);
});

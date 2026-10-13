const db = require("./db");
const E = require("../shared/engine.js");

function loadState() {
  const medicines = db.prepare("SELECT * FROM medicines").all().map(function (m) {
    return { id: m.id, name: m.name, form: m.form, unit: m.unit, category: m.category };
  });
  const centres = db.prepare("SELECT * FROM centres").all().map(function (c) {
    return { id: c.id, name: c.name, area: c.area, distanceKm: c.distance_km, phone: c.phone, incharge: c.incharge };
  });
  const suppliers = db.prepare("SELECT * FROM suppliers").all().map(function (s) {
    return { id: s.id, name: s.name, contact: s.contact, rating: s.rating, leadTimeDays: s.lead_time_days };
  });
  const customers = db.prepare("SELECT * FROM customers").all().map(function (c) {
    return { id: c.id, name: c.name, phone: c.phone, area: c.area };
  });

  const stock = {};
  db.prepare("SELECT * FROM stock").all().forEach(function (r) {
    if (!stock[r.centre_id]) stock[r.centre_id] = {};
    stock[r.centre_id][r.med_id] = { qty: r.qty, daily: r.daily, safety: r.safety, lead: r.lead };
  });

  const customerRequests = db.prepare("SELECT * FROM customer_requests").all().map(function (r) {
    return {
      id: r.id, customerId: r.customer_id, centreId: r.centre_id, medId: r.med_id,
      qty: r.qty, prescription: !!r.prescription, prescriptionName: r.prescription_name,
      homeAddress: r.home_address, status: r.status, createdAt: r.created_at, responseNote: r.response_note,
      events: JSON.parse(r.events || "[]")
    };
  });

  const supplyRequests = db.prepare("SELECT * FROM supply_requests").all().map(function (r) {
    return {
      id: r.id, centreId: r.centre_id, supplierId: r.supplier_id, medId: r.med_id,
      qty: r.qty, acceptedQty: r.accepted_qty, dispatchedQty: r.dispatched_qty,
      status: r.status, eta: r.eta, note: r.note, events: JSON.parse(r.events || "[]")
    };
  });

  const transfers = db.prepare("SELECT * FROM transfers").all().map(function (r) {
    return { id: r.id, medId: r.med_id, donorId: r.donor_id, receiverId: r.receiver_id, qty: r.qty, approvedAt: r.approved_at };
  });

  return { medicines, centres, suppliers, customers, stock, customerRequests, supplyRequests, transfers };
}

/* All data visible to all roles - no information access restrictions */
function scopeState(state, user) {
  return state;
}

function nextId(prefix, table) {
  const rows = db.prepare("SELECT id FROM " + table).all();
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r.id).match(/(\d+)\s*$/);
    if (m) { const n = Number(m[1]); if (n > max) max = n; }
  });
  return prefix + (max + 1);
}

function centreName(id) {
  const c = db.prepare("SELECT name FROM centres WHERE id = ?").get(id);
  return c ? c.name : id;
}

function medInfo(id) {
  const m = db.prepare("SELECT name, unit FROM medicines WHERE id = ?").get(id);
  return m || { name: id, unit: "unit" };
}

function appendEvent(table, id, text) {
  const row = db.prepare("SELECT events FROM " + table + " WHERE id = ?").get(id);
  const ev = JSON.parse((row && row.events) || "[]");
  ev.push({ time: E.nowStamp(), text: text });
  db.prepare("UPDATE " + table + " SET events = ? WHERE id = ?").run(JSON.stringify(ev), id);
}

function addCustomerRequest(p) {
  const id = nextId("CR-", "customer_requests");
  const stamp = E.nowStamp();
  const med = medInfo(p.medId);
  const events = [
    { time: stamp, text: "Request sent to " + centreName(p.centreId) },
    { time: stamp, text: "Requested " + p.qty + " " + med.unit + "(s) of " + med.name }
  ];
  db.prepare(`INSERT INTO customer_requests
    (id,customer_id,centre_id,med_id,qty,prescription,prescription_name,home_address,status,created_at,response_note,events)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, p.customerId, p.centreId, p.medId, p.qty, p.prescription ? 1 : 0,
      p.prescriptionName || "", p.homeAddress || "", "pending", stamp, "", JSON.stringify(events));
  return id;
}

function respondCustomerRequest(id, p) {
  const r = db.prepare("SELECT * FROM customer_requests WHERE id = ?").get(id);
  if (!r) return false;
  const row = db.prepare("SELECT qty FROM stock WHERE centre_id = ? AND med_id = ?").get(r.centre_id, r.med_id);
  const available = row ? row.qty : 0;
  let provideQty = Number(p.qty) || 0;
  let decision = p.decision;
  if (decision === "accepted") provideQty = Math.min(r.qty, available);
  if (decision === "out_of_stock") provideQty = 0;
  if (provideQty <= 0) { decision = "out_of_stock"; provideQty = 0; }

  if (provideQty > 0) {
    db.prepare("UPDATE stock SET qty = qty - ? WHERE centre_id = ? AND med_id = ?")
      .run(provideQty, r.centre_id, r.med_id);
  }
  db.prepare("UPDATE customer_requests SET status=?, response_note=? WHERE id=?")
    .run(decision, p.note || "", id);
  const med = medInfo(r.med_id);
  appendEvent("customer_requests", id, "PHC " + decision.replace("_", " ") +
    (provideQty ? " (" + provideQty + " " + med.unit + "s)" : "") + (p.note ? ": " + p.note : ""));
  return true;
}

function approveTransfer(p) {
  const donor = db.prepare("SELECT qty FROM stock WHERE centre_id = ? AND med_id = ?").get(p.donorId, p.medId);
  const recv = db.prepare("SELECT qty FROM stock WHERE centre_id = ? AND med_id = ?").get(p.receiverId, p.medId);
  if (!donor || !recv) return false;
  const move = Math.min(Number(p.qty) || 0, donor.qty);
  if (move <= 0) return false;
  db.prepare("UPDATE stock SET qty = qty - ? WHERE centre_id = ? AND med_id = ?").run(move, p.donorId, p.medId);
  db.prepare("UPDATE stock SET qty = qty + ? WHERE centre_id = ? AND med_id = ?").run(move, p.receiverId, p.medId);
  db.prepare("INSERT INTO transfers (id,med_id,donor_id,receiver_id,qty,approved_at) VALUES (?,?,?,?,?,?)")
    .run(nextId("TRR-", "transfers"), p.medId, p.donorId, p.receiverId, move, E.nowStamp());
  return true;
}

function addSupplyRequest(p) {
  const id = nextId("SR-", "supply_requests");
  const events = [{ time: E.nowStamp(), text: "Supply request raised to " + supplierName(p.supplierId) }];
  db.prepare(`INSERT INTO supply_requests
    (id,centre_id,supplier_id,med_id,qty,accepted_qty,dispatched_qty,status,eta,note,created_at,events)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, p.centreId, p.supplierId, p.medId, p.qty, 0, 0, "pending", "", p.note || "", E.nowStamp(), JSON.stringify(events));
  return id;
}

function supplierName(id) {
  const s = db.prepare("SELECT name FROM suppliers WHERE id = ?").get(id);
  return s ? s.name : id;
}

function supplyAction(id, p) {
  const r = db.prepare("SELECT * FROM supply_requests WHERE id = ?").get(id);
  if (!r) return false;
  const sup = supplierName(r.supplier_id);
  const med = medInfo(r.med_id);

  if (p.action === "accept") {
    const eta = p.eta || E.addDays(3);
    db.prepare("UPDATE supply_requests SET status=?, eta=? WHERE id=?").run("accepted", eta, id);
    appendEvent("supply_requests", id, sup + " accepted, expected " + eta);
  } else if (p.action === "partial") {
    const q = Math.max(1, Math.min(Number(p.qty) || 0, r.qty));
    const eta = p.eta || E.addDays(4);
    db.prepare("UPDATE supply_requests SET status=?, accepted_qty=?, eta=? WHERE id=?").run("partial", q, eta, id);
    appendEvent("supply_requests", id, sup + " partially fulfilled " + q + " of " + r.qty + ", expected " + eta);
  } else if (p.action === "reject") {
    db.prepare("UPDATE supply_requests SET status=? WHERE id=?").run("rejected", id);
    appendEvent("supply_requests", id, "Rejected by " + sup + ": " + (p.reason || "no reason given"));
  } else if (p.action === "dispatch") {
    const q = Math.max(1, Math.min(Number(p.qty) || 0, r.accepted_qty || r.qty));
    db.prepare("UPDATE supply_requests SET status=?, dispatched_qty=? WHERE id=?").run("dispatched", q, id);
    appendEvent("supply_requests", id, "Dispatched " + q + " " + med.unit + "(s), in transit");
  } else if (p.action === "receive") {
    const q = r.dispatched_qty || r.qty;
    const row = db.prepare("SELECT qty FROM stock WHERE centre_id=? AND med_id=?").get(r.centre_id, r.med_id);
    if (row) {
      db.prepare("UPDATE stock SET qty = qty + ? WHERE centre_id=? AND med_id=?").run(q, r.centre_id, r.med_id);
    } else {
      db.prepare("INSERT INTO stock (centre_id,med_id,qty,daily,safety,lead) VALUES (?,?,?,?,?,?)")
        .run(r.centre_id, r.med_id, q, 0, 0, 3);
    }
    db.prepare("UPDATE supply_requests SET status=? WHERE id=?").run("delivered", id);
    appendEvent("supply_requests", id, "Receipt confirmed by " + centreName(r.centre_id) + " (+" + q + " stock)");
  } else {
    return false;
  }
  return true;
}

module.exports = {
  loadState, scopeState, nextId,
  addCustomerRequest, respondCustomerRequest, approveTransfer, addSupplyRequest, supplyAction
};

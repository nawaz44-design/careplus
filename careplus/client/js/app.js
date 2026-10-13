/* CarePlus app — role-based views, actions, transfer-first workflow */
(function () {
  "use strict";

  const E = window.CP_ENGINE;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  const SESSION_KEY = "careplus.session";
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (err) { session = null; }
  if (!session || !session.role) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("role")) {
      session = { role: params.get("role"), id: params.get("id") || "", name: params.get("name") || "User" };
    }
  }
  if (!session || ["customer", "phc", "stockholder"].indexOf(session.role) === -1) {
    window.location.replace("login.html");
    return;
  }

  const state = clone(window.CP_SEED);
  state.ui = {
    role: session.role,
    customerMed: "m_para",
    customerArea: "all",
    phcCentre: session.role === "phc" ? session.id : "C1",
    stockSupplier: session.role === "stockholder" ? session.id : "S1"
  };
  if (session.role === "customer") state.currentCustomerId = session.id;
  if (session.role === "customer" && !state.customers.some(function (c) { return c.id === session.id; })) {
    state.customers.push({ id: session.id, name: session.name || "Customer", phone: session.phone || "", area: "" });
  }

  /* ---------------- live backend state ---------------- */
  let live = false;
  let remoteSnapshot = null;
  let refreshingRemote = false;
  let connectionWarningShown = false;
  const knownCustomerRequestIds = new Set(
    (state.customerRequests || []).map(function (request) { return request.id; })
  );

  function signOut() {
    if (window.CP_API) window.CP_API.clear();
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    window.location.replace("login.html");
  }

  function applyState(remote) {
    Object.keys(remote).forEach(function (k) { state[k] = remote[k]; });
    rememberRemoteState(remote);
    render();
  }

  function rememberRemoteState(remote) {
    remoteSnapshot = JSON.stringify(remote);
    (remote.customerRequests || []).forEach(function (request) {
      knownCustomerRequestIds.add(request.id);
    });
  }

  async function loadRemote() {
    if (!window.CP_API || !CP_API.hasToken()) return;
    try {
      const remote = await CP_API.getState();
      Object.keys(remote).forEach(function (k) { state[k] = remote[k]; });
      live = true;
      rememberRemoteState(remote);
    } catch (err) {
      if (err && err.status === 401) { CP_API.clear(); window.location.replace("login.html"); return; }
      /* offline: keep local seed data */
    }
  }

  async function refreshLiveState() {
    if (session.role !== "phc" || refreshingRemote ||
        !window.CP_API || !CP_API.hasToken()) return;
    refreshingRemote = true;
    try {
      const remote = await CP_API.getState();
      const newRequests = (remote.customerRequests || []).filter(function (request) {
        return request.centreId === session.id && request.status === "pending" &&
          !knownCustomerRequestIds.has(request.id);
      });
      const changed = JSON.stringify(remote) !== remoteSnapshot;
      live = true;
      connectionWarningShown = false;
      newRequests.forEach(function (request) { knownCustomerRequestIds.add(request.id); });
      if (changed) applyState(remote);
      newRequests.forEach(function (request) {
        const customerName = customer(request.customerId);
        const medicine = med(request.medId);
        toast("New request from " + (customerName ? customerName.name : "a customer") +
          ": " + (medicine ? medicine.name : "medicine") + " × " + request.qty);
      });
    } catch (err) {
      if (err && err.status === 401) {
        signOut();
        return;
      }
      if (!connectionWarningShown) {
        toast(err && err.offline ? "Connection lost — retrying for new requests." :
          "Could not refresh requests: " + ((err && err.message) || "request failed"), "warn");
        connectionWarningShown = true;
      }
    } finally {
      refreshingRemote = false;
    }
  }

  function remoteOrLocal(remoteCall, localCall) {
    if (!live || !window.CP_API) { localCall(); render(); return; }
    remoteCall().then(applyState).catch(function (err) {
      if (err && err.status === 401) {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
        window.location.replace("login.html");
        return;
      }
      if (err && err.offline) { toast("Offline — saved on this device", "warn"); localCall(); render(); }
      else { toast((err && err.message) || "Action failed", "warn"); }
    });
  }

  /* ---------------- lookups ---------------- */
  function med(id) { return state.medicines.find(function (m) { return m.id === id; }); }
  function centre(id) { return state.centres.find(function (c) { return c.id === id; }); }
  function supplier(id) { return state.suppliers.find(function (s) { return s.id === id; }); }
  function customer(id) { return state.customers.find(function (c) { return c.id === id; }); }
  function currentCustomer() { return customer(state.currentCustomerId); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------------- toasts & modal ---------------- */
  function toast(msg, type) {
    const stack = document.getElementById("toastStack");
    const el = document.createElement("div");
    el.className = "toast" + (type === "warn" ? " warn" : "");
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 300);
    }, 3200);
  }

  const backdrop = document.getElementById("modalBackdrop");
  const modalEl = document.getElementById("modal");

  function openModal(html, onMount) {
    modalEl.innerHTML = html;
    backdrop.hidden = false;
    if (typeof onMount === "function") onMount(modalEl);
  }
  function closeModal() {
    backdrop.hidden = true;
    modalEl.innerHTML = "";
  }
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !backdrop.hidden) closeModal();
  });

  /* Generic form modal.
     fields: { name, label, type: text|number|select|date|textarea|file, value, options, min, required, hint } */
  function formModal(opts) {
    const fieldsHtml = opts.fields.map(function (f) {
      let control;
      if (f.type === "select") {
        control = '<select name="' + f.name + '">' + f.options.map(function (o) {
          return '<option value="' + esc(o.value) + '"' +
            (String(o.value) === String(f.value) ? " selected" : "") + ">" + esc(o.label) + "</option>";
        }).join("") + "</select>";
      } else if (f.type === "textarea") {
        control = '<textarea name="' + f.name + '" placeholder="' + esc(f.placeholder || "") + '">' +
          esc(f.value || "") + "</textarea>";
      } else if (f.type === "file") {
        control = '<div class="file-drop" data-file-drop>Click to attach a file' +
          '<input type="file" name="' + f.name + '" hidden></div>';
      } else {
        control = '<input type="' + (f.type || "text") + '" name="' + f.name + '"' +
          (f.min != null ? ' min="' + f.min + '"' : "") +
          (f.step != null ? ' step="' + f.step + '"' : "") +
          (f.required ? " required" : "") +
          ' value="' + esc(f.value == null ? "" : f.value) + '" placeholder="' + esc(f.placeholder || "") + '">';
      }
      return '<label class="field"><span>' + esc(f.label) + '</span>' + control +
        (f.hint ? '<div class="hint mt-8">' + esc(f.hint) + "</div>" : "") + "</label>";
    }).join("");

    openModal(
      '<h2>' + esc(opts.title) + "</h2>" +
      (opts.sub ? '<div class="modal-sub">' + esc(opts.sub) + "</div>" : "") +
      '<form id="modalForm">' + fieldsHtml +
      '<div class="modal-actions">' +
      '<button type="button" class="btn subtle" data-close>Cancel</button>' +
      '<button type="submit" class="btn">' + esc(opts.submitLabel || "Confirm") + "</button>" +
      "</div></form>",
      function (root) {
        root.querySelectorAll("[data-close]").forEach(function (b) {
          b.addEventListener("click", closeModal);
        });
        root.querySelectorAll("[data-file-drop]").forEach(function (drop) {
          const input = drop.querySelector("input[type=file]");
          drop.addEventListener("click", function () { input.click(); });
          input.addEventListener("change", function () {
            if (input.files && input.files.length) {
              drop.textContent = input.files[0].name;
              drop.classList.add("has-file");
            }
          });
        });
        const form = root.querySelector("#modalForm");
        form.addEventListener("submit", function (ev) {
          ev.preventDefault();
          const data = {};
          opts.fields.forEach(function (f) {
            const input = form.querySelector('[name="' + f.name + '"]');
            if (!input) return;
            if (f.type === "file") data[f.name] = input.files && input.files.length ? input.files[0].name : "";
            else data[f.name] = input.value;
          });
          const ok = opts.onSubmit(data);
          if (ok !== false) closeModal();
        });
      }
    );
  }

  /* ---------------- shared HTML bits ---------------- */
  function statCard(num, label, tone) {
    return '<div class="stat' + (tone ? " " + tone : "") + '"><div class="num">' + num +
      '</div><div class="lbl">' + esc(label) + "</div></div>";
  }

  function timeline(events) {
    return '<ul class="timeline">' + events.map(function (ev) {
      return '<li><div class="t-text">' + esc(ev.text) + '</div><div class="t-time">' +
        esc(ev.time) + "</div></li>";
    }).join("") + "</ul>";
  }

  /* ---------------- topbar ---------------- */
  function roleLabel(r) {
    return { customer: "Customer", phc: "Pharmacist · PHC", stockholder: "Stockholder" }[r] || r;
  }

  function renderTopbarMeta() {
    const meta = document.getElementById("topbarMeta");
    meta.innerHTML =
      '<span class="identity"><b>' + esc(session.name) + '</b>' +
      '<span class="pill green">' + roleLabel(session.role) + "</span></span>" +
      '<button class="btn ghost sm" id="logoutBtn">Log out</button>';
    meta.querySelector("#logoutBtn").addEventListener("click", function () {
      signOut();
    });
  }

  /* ================= CUSTOMER ================= */
  function renderCustomer() {
    const me = currentCustomer();
    const medOptions = state.medicines.map(function (m) {
      return '<option value="' + m.id + '"' + (m.id === state.ui.customerMed ? " selected" : "") + ">" +
        esc(m.name) + " (" + esc(m.form) + ")</option>";
    }).join("");

    const areaOptions = '<option value="all"' + (state.ui.customerArea === "all" ? " selected" : "") +
      ">All nearby centres</option>" +
      state.centres.map(function (c) {
        return '<option value="' + esc(c.area) + '"' + (state.ui.customerArea === c.area ? " selected" : "") +
          ">" + esc(c.area) + "</option>";
      }).join("");

    const results = E.availability(state, state.ui.customerMed)
      .filter(function (r) { return state.ui.customerArea === "all" || r.centre.area === state.ui.customerArea; });

    const myReqs = state.customerRequests
      .filter(function (r) { return r.customerId === me.id; })
      .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });

    const html =
      '<div class="page-head"><h1>Find &amp; request medicine</h1>' +
      "<p>Search nearby PHCs for medicine availability, upload a prescription when required, " +
      "send your request, and track updates. You can only see your own requests and public availability.</p></div>" +

      '<div class="card section"><div class="card-body">' +
      '<div class="inline-form">' +
      '<label class="field" style="flex:2 1 260px"><span>Medicine</span><select id="custMed">' + medOptions + "</select></label>" +
      '<label class="field" style="flex:1 1 180px"><span>Area</span><select id="custArea">' + areaOptions + "</select></label>" +
      '<button class="btn" id="custSearch">Search availability</button>' +
      "</div></div></div>" +

      '<div class="section"><h2 class="section-title">Availability near you</h2>' +
      '<div class="grid cols-3">' +
      (results.length ? results.map(function (r) {
        return '<div class="card"><div class="card-body centre-card">' +
          '<div class="centre-top"><div><div class="centre-name">' + esc(r.centre.name) + "</div>" +
          '<div class="centre-meta">' + esc(r.centre.area) + " · " + r.centre.distanceKm + " km · " +
          esc(r.centre.phone) + "</div></div>" +
          '<span class="pill ' + r.cls + '">' + r.label + "</span></div>" +
          '<div class="stock-read"><b>' + r.entry.qty + "</b><span class=\"hint\">" +
          esc(med(state.ui.customerMed).unit) + "(s) available publicly</span></div>" +
          '<div class="avail-row"><span class="hint">Approx. supply left: ' + r.m.coverage +
          " day(s)</span></div>" +
          '<div class="chips">' +
          '<button class="btn sm" data-request-centre="' + r.centre.id + '">Send request</button>' +
          '<a class="btn sm ghost" href="tel:' + esc(r.centre.phone.replace(/\s/g, "")) +
          '" data-call="' + r.centre.id + '">Call PHC</a>' +
          "</div></div></div>";
      }).join("") : '<div class="empty">No centres match this area.</div>') +
      "</div></div>" +

      '<div class="section"><div class="row-between"><h2 class="section-title" style="margin:0">My requests</h2></div>' +
      '<div class="grid cols-2 mt-16">' +
      (myReqs.length ? myReqs.map(function (r) {
        return '<div class="card"><div class="card-head">' +
          '<div><h3>' + esc(med(r.medId).name) + " × " + r.qty + "</h3>" +
          '<div class="card-sub">' + esc(r.id) + " · " + esc(centre(r.centreId).name) +
          " · " + esc(r.createdAt) + "</div></div>" +
          reqBadge(r.status) + "</div>" +
          '<div class="card-body">' +
          '<div class="avail-row"><span class="hint">Prescription:</span> ' +
          (r.prescription ? '<span class="pill blue">' + esc(r.prescriptionName) + "</span>"
            : '<span class="pill grey">Not required</span>') + "</div>" +
          (r.homeAddress ? '<div class="avail-row"><span class="hint">Home address:</span> <span>' + esc(r.homeAddress) + "</span></div>" : "") +
          (r.responseNote ? '<div class="transfer-note">PHC response: <b>' + esc(r.responseNote) +
            "</b></div>" : '<div class="hint mt-8">Awaiting PHC response.</div>') +
          '<div class="mt-16">' + timeline(r.events) + "</div>" +
          "</div></div>";
      }).join("") : '<div class="empty">You have no requests yet.</div>') +
      "</div></div>";

    return html;
  }

  function reqBadge(status) {
    const map = {
      pending: ["Pending", "amber"],
      accepted: ["Accepted", "green"],
      partial: ["Partial", "blue"],
      out_of_stock: ["Out of stock", "red"],
      fulfilled: ["Fulfilled", "green"]
    };
    const b = map[status] || [status, "grey"];
    return '<span class="pill ' + b[1] + '">' + b[0] + "</span>";
  }

  function wireCustomer() {
    const medSel = document.getElementById("custMed");
    if (medSel) medSel.addEventListener("change", function (e) {
      state.ui.customerMed = e.target.value; render();
    });
    const areaSel = document.getElementById("custArea");
    if (areaSel) areaSel.addEventListener("change", function (e) {
      state.ui.customerArea = e.target.value; render();
    });
    const searchBtn = document.getElementById("custSearch");
    if (searchBtn) searchBtn.addEventListener("click", function () {
      toast("Showing live public availability");
    });

    document.querySelectorAll("[data-call]").forEach(function (a) {
      a.addEventListener("click", function () { toast("Calling " + centre(a.dataset.call).name + "…"); });
    });
    document.querySelectorAll("[data-request-centre]").forEach(function (b) {
      b.addEventListener("click", function () { openCustomerRequest(b.dataset.requestCentre); });
    });
  }

  function openCustomerRequest(centreId) {
    const m = med(state.ui.customerMed);
    formModal({
      title: "Send medicine request",
      sub: "This request goes to " + centre(centreId).name + ". Upload a prescription if required.",
      fields: [
        { name: "medId", label: "Medicine", type: "select", value: m.id,
          options: state.medicines.map(function (x) { return { value: x.id, label: x.name + " (" + x.form + ")" }; }) },
        { name: "qty", label: "Quantity (" + m.unit + "s)", type: "number", min: 1, value: 10, required: true },
        { name: "homeAddress", label: "Home address (optional)", type: "textarea", placeholder: "Enter your home address for delivery" },
        { name: "prescription", label: "Prescription (optional)", type: "file",
          hint: "Upload an image or PDF. Visible only to you and the PHC you send it to." },
        { name: "note", label: "Note to PHC (optional)", type: "textarea", placeholder: "e.g. needed today" }
      ],
      submitLabel: "Send request",
      onSubmit: function (data) {
        const qty = parseInt(data.qty, 10);
        if (!qty || qty < 1) { toast("Enter a valid quantity", "warn"); return false; }
        const payload = {
          centreId: centreId, medId: data.medId, qty: qty,
          prescription: !!data.prescription, prescriptionName: data.prescription || "", homeAddress: data.homeAddress || "", note: data.note || ""
        };
        remoteOrLocal(
          function () { return CP_API.customerRequest(payload); },
          function () { localCustomerRequest(centreId, data.medId, qty, data.prescription, data.homeAddress, data.note); }
        );
      }
    });
  }

  function localCustomerRequest(centreId, medId, qty, prescriptionName, homeAddress, note) {
    const id = "CR-" + (1042 + state.customerRequests.length + 1);
    const stamp = E.nowStamp();
    const medObj = med(medId);
    state.customerRequests.push({
      id: id, customerId: state.currentCustomerId, centreId: centreId, medId: medId, qty: qty,
      prescription: !!prescriptionName, prescriptionName: prescriptionName || "", homeAddress: homeAddress || "",
      status: "pending", createdAt: stamp, responseNote: note || "",
      events: [
        { time: stamp, text: "Request sent to " + centre(centreId).name },
        { time: stamp, text: "Requested " + qty + " " + medObj.unit + "(s) of " + medObj.name }
      ]
    });
    toast("Request " + id + " sent to " + centre(centreId).name);
  }

  /* ================= PHC ================= */
  function renderPHC() {
    const cid = state.ui.phcCentre;
    const centreObj = centre(cid);
    const forecast = E.centreForecast(state, cid);
    const rec = E.recommend(state);
    const myTransfers = rec.transfers.filter(function (t) { return t.receiverId === cid; });
    const myReorders = rec.reorders.filter(function (r) { return r.centreId === cid; });
    const incoming = state.customerRequests
      .filter(function (r) { return r.centreId === cid; })
      .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    const pendingIncoming = incoming.filter(function (r) { return r.status === "pending"; });
    const mySupply = state.supplyRequests.filter(function (r) { return r.centreId === cid; });
    const openSupply = mySupply.filter(function (r) {
      return ["pending", "accepted", "partial", "dispatched"].indexOf(r.status) !== -1;
    });

    const html =
      '<div class="page-head"><h1>' + esc(centreObj.name) + " — PHC console</h1>" +
      "<p>Receive customer requests, respond from your own stock, forecast shortages, " +
      "coordinate transfers with other centres, and raise supply requests to stockholders.</p></div>" +

      '<div class="grid cols-4 section">' +
      statCard(pendingIncoming.length, "Pending customer requests", pendingIncoming.length ? "warn" : "") +
      statCard(forecast.atRisk.length, "Items short / at risk", forecast.atRisk.length ? "bad" : "") +
      statCard(myTransfers.length, "Transfers recommended") +
      statCard(openSupply.length, "Open supply requests") +
      "</div>" +

      '<div class="section"><h2 class="section-title">Incoming customer requests</h2>' +
      '<div class="card"><div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Request</th><th>Customer</th><th>Address</th><th>Medicine</th><th>Qty</th><th>Prescription</th><th>Status</th><th></th>" +
      "</tr></thead><tbody>" +
      (incoming.length ? incoming.map(function (r) {
        const cust = customer(r.customerId);
        return "<tr><td><b>" + esc(r.id) + "</b><div class=\"hint\">" + esc(r.createdAt) + "</div></td>" +
          "<td>" + esc(cust.name) + '<div class="hint">' + esc(cust.phone) + "</div></td>" +
          "<td>" + (r.homeAddress ? esc(r.homeAddress) : '<span class="hint">Not provided</span>') + "</td>" +
          "<td>" + esc(med(r.medId).name) + "</td><td>" + r.qty + "</td>" +
          "<td>" + (r.prescription ? '<span class="pill blue">' + esc(r.prescriptionName) + "</span>"
            : '<span class="pill grey">Not required</span>') + "</td>" +
          "<td>" + reqBadge(r.status) + "</td>" +
          '<td>' + (r.status === "pending"
            ? '<button class="btn sm" data-respond="' + r.id + '">Respond</button>'
            : '<span class="hint">' + esc(r.responseNote || "—") + "</span>") + "</td></tr>";
      }).join("") : '<tr><td colspan="7"><div class="empty">No customer requests for this centre.</div></td></tr>') +
      "</tbody></table></div></div></div>" +

      transferSection(cid, myTransfers, myReorders) +

      '<div class="section"><div class="row-between"><h2 class="section-title" style="margin:0">My inventory</h2>' +
      '<button class="btn soft" id="newSupply">Raise supply request</button></div>' +
      '<div class="card mt-16"><div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Medicine</th><th>On hand</th><th>Safety stock</th><th>Daily use</th><th>Coverage</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      forecast.all.map(function (r) {
        const pct = Math.min(100, Math.round((r.m.qty / Math.max(r.m.safety, 1)) * 100));
        const cls = r.m.status === "ok" ? "" : (r.m.status === "watch" ? "warn" : "bad");
        return "<tr><td>" + esc(r.med.name) + '<div class="hint">' + esc(r.med.category) + "</div></td>" +
          "<td><b>" + r.m.qty + "</b></td><td>" + r.m.safety + "</td><td>" + r.m.daily + "</td>" +
          '<td><div class="bar ' + cls + '"><i style="width:' + pct + '%"></i></div>' +
          '<span class="hint">' + r.m.coverage + " day(s)</span></td>" +
          "<td>" + '<span class="pill ' + E.statusPill(r.m.status) + '">' + E.statusLabel(r.m.status) + "</span></td></tr>";
      }).join("") +
      "</tbody></table></div></div></div>" +

      '<div class="section"><h2 class="section-title">Supply requests to stockholders</h2>' +
      '<div class="card"><div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Request</th><th>Supplier</th><th>Medicine</th><th>Qty</th><th>Status</th><th>ETA</th><th>Dispatched</th>" +
      "</tr></thead><tbody>" +
      (mySupply.length ? mySupply.map(function (r) {
        return "<tr><td><b>" + esc(r.id) + "</b></td><td>" + esc(supplier(r.supplierId).name) + "</td>" +
          "<td>" + esc(med(r.medId).name) + "</td><td>" + r.qty + "</td>" +
          "<td>" + supplyBadge(r.status) + "</td><td>" + esc(r.eta || "—") + "</td>" +
          "<td>" + (r.dispatchedQty || 0) + "</td></tr>";
      }).join("") : '<tr><td colspan="7"><div class="empty">No supply requests raised.</div></td></tr>') +
      "</tbody></table></div></div></div>";

    return html;
  }

  function supplyBadge(status) {
    const map = {
      pending: ["Pending", "amber"],
      accepted: ["Accepted", "green"],
      rejected: ["Rejected", "red"],
      partial: ["Partial", "blue"],
      dispatched: ["Dispatched", "blue"],
      delivered: ["Delivered", "green"]
    };
    const b = map[status] || [status, "grey"];
    return '<span class="pill ' + b[1] + '">' + b[0] + "</span>";
  }

  function transferSection(cid, transfers, reorders) {
    return '<div class="section"><h2 class="section-title">Transfer recommendations (transfer-first)</h2>' +
      '<div class="access-note ok" style="margin-bottom:14px">' +
      "<span>Rule:</span><span>When a centre is short and another has surplus, propose the transfer and show its effect on both, before requesting a district reorder.</span></div>" +
      '<div class="grid cols-2">' +
      (transfers.length ? transfers.map(function (t, i) {
        const donor = centre(t.donorId);
        const recName = centre(t.receiverId).name;
        return '<div class="transfer">' +
          '<div class="transfer-head"><div class="transfer-title">' + esc(med(t.medId).name) + " × " + t.qty + "</div>" +
          '<span class="pill green">Transfer</span></div>' +
          '<div class="transfer-flow">' +
          '<div class="flow-node"><div class="who">Donor (has surplus)</div>' +
          '<div class="cname">' + esc(donor.name) + "</div>" +
          '<div class="flow-effect">' +
          "<span>Stock: <b>" + t.donor.before + " → " + t.donor.after + "</b></span>" +
          '<span class="delta down">−' + t.qty + " released above safety (" + t.donor.surplusBefore + " → " +
          t.donor.surplusAfter + " surplus)</span>" +
          "</div></div>" +
          '<div class="flow-arrow"><span class="qty">→<br>' + t.qty + "</span></div>" +
          '<div class="flow-node"><div class="who">Receiver (short)</div>' +
          '<div class="cname">' + esc(recName) + "</div>" +
          '<div class="flow-effect">' +
          "<span>Stock: <b>" + t.receiver.before + " → " + t.receiver.after + "</b></span>" +
          '<span class="delta up">Coverage: ' + t.receiver.coverageBefore + " → " + t.receiver.coverageAfter + " days</span>" +
          "</div></div>" +
          "</div>" +
          '<div class="transfer-note">Effect on both: <b>' + esc(recName) + "</b> gains " + t.qty +
          " " + esc(med(t.medId).unit) + "(s); <b>" + esc(donor.name) + "</b> stays at or above its safety stock (" +
          t.donor.after + " ≥ " + t.donor.safety + "). " + esc(t.reason) + ".</div>" +
          '<div class="transfer-actions">' +
          '<button class="btn" data-approve-transfer="' + t.id + '">Approve transfer</button>' +
          '<button class="btn ghost" data-reject-transfer="' + esc(t.id) + '">Dismiss</button>' +
          "</div></div>";
      }).join("") : '<div class="empty">No transfers needed — all items covered.</div>') +
      "</div>" +

      '<h2 class="section-title" style="margin-top:24px">District reorders (only after transfers)</h2>' +
      '<div class="grid cols-2">' +
      (reorders.length ? reorders.map(function (r) {
        return '<div class="card"><div class="card-body">' +
          '<div class="row-between"><div><div class="centre-name">' + esc(med(r.medId).name) +
          " × " + r.reorderQty + "</div>" +
          '<div class="hint">' + esc(centre(r.centreId).name) + "</div></div>" +
          '<span class="pill amber">Reorder</span></div>' +
          '<div class="transfer-note mt-16">' + esc(r.reason) + ".</div>" +
          (r.hasOpenRequest
            ? '<div class="pill blue mt-16">Supply request already open</div>'
            : '<div class="transfer-actions"><button class="btn soft" data-raise-supply="' + r.medId +
              '" data-qty="' + r.reorderQty + '">Raise supply request</button></div>') +
          "</div></div>";
      }).join("") : '<div class="empty">No uncovered shortfalls — no district reorder needed.</div>') +
      "</div></div>";
  }

  function wirePHC() {
    document.querySelectorAll("[data-respond]").forEach(function (b) {
      b.addEventListener("click", function () { openRespond(b.dataset.respond); });
    });
    document.querySelectorAll("[data-approve-transfer]").forEach(function (b) {
      b.addEventListener("click", function () { approveTransfer(b.dataset.approveTransfer); });
    });
    document.querySelectorAll("[data-reject-transfer]").forEach(function (b) {
      b.addEventListener("click", function () { toast("Transfer proposal dismissed"); });
    });
    document.querySelectorAll("[data-raise-supply]").forEach(function (b) {
      b.addEventListener("click", function () {
        openRaiseSupply(b.dataset.raiseSupply, parseInt(b.dataset.qty, 10));
      });
    });
    const ns = document.getElementById("newSupply");
    if (ns) ns.addEventListener("click", function () { openRaiseSupply(null, null); });
  }

  function openRespond(reqId) {
    const r = state.customerRequests.find(function (x) { return x.id === reqId; });
    if (!r) return;
    const m = med(r.medId);
    const entry = state.stock[r.centreId][r.medId];
    formModal({
      title: "Respond to " + r.id,
      sub: customer(r.customerId).name + " requested " + r.qty + " " + m.unit + "(s) of " + m.name +
        ". Your stock on hand: " + entry.qty + ".",
      fields: [
        { name: "decision", label: "Decision", type: "select", value: entry.qty >= r.qty ? "accepted" : "partial",
          options: [
            { value: "accepted", label: "Accept — full quantity available" },
            { value: "partial", label: "Partially fulfil" },
            { value: "out_of_stock", label: "Out of stock" }
          ] },
        { name: "qty", label: "Quantity you can provide", type: "number", min: 1, value: Math.min(r.qty, entry.qty) },
        { name: "note", label: "Message to customer", type: "text", value: "Stock available. Please carry ID." }
      ],
      submitLabel: "Send response",
      onSubmit: function (data) {
        let provideQty = parseInt(data.qty, 10) || 0;
        const decision = data.decision;
        if (decision === "out_of_stock") provideQty = 0;
        if (decision === "accepted") provideQty = Math.min(r.qty, entry.qty);
        const finalDecision = provideQty <= 0 ? "out_of_stock" : decision;
        remoteOrLocal(
          function () { return CP_API.respondRequest(reqId, { decision: finalDecision, qty: provideQty, note: data.note }); },
          function () { localRespond(reqId, finalDecision, provideQty, data.note); }
        );
      }
    });
  }

  function localRespond(reqId, decision, provideQty, note) {
    const r = state.customerRequests.find(function (x) { return x.id === reqId; });
    if (!r) return;
    const m = med(r.medId);
    const entry = state.stock[r.centreId][r.medId];
    entry.qty = Math.max(0, entry.qty - provideQty);
    r.status = decision;
    r.responseNote = note;
    r.events.push({ time: E.nowStamp(), text: "PHC " + decision.replace("_", " ") +
      (provideQty ? " (" + provideQty + " " + m.unit + "s)" : "") + ": " + note });
    toast("Responded to " + r.id);
  }

  function approveTransfer(id) {
    const rec = E.recommend(state);
    const t = rec.transfers.find(function (x) { return x.id === id; });
    if (!t) { toast("Proposal no longer available", "warn"); return; }
    remoteOrLocal(
      function () {
        return CP_API.approveTransfer({
          donorId: t.donorId, receiverId: t.receiverId, medId: t.medId, qty: t.qty
        });
      },
      function () {
        state.stock[t.donorId][t.medId].qty -= t.qty;
        state.stock[t.receiverId][t.medId].qty += t.qty;
        state.transfers.push({
          id: E.nextId("TRR", state.transfers),
          medId: t.medId, donorId: t.donorId, receiverId: t.receiverId, qty: t.qty,
          approvedAt: E.nowStamp()
        });
        toast("Transfer approved: " + t.qty + " " + med(t.medId).unit + "(s) " +
          centre(t.donorId).name + " → " + centre(t.receiverId).name);
      }
    );
  }

  function openRaiseSupply(medId, qty) {
    const cid = state.ui.phcCentre;
    formModal({
      title: "Raise supply request",
      sub: "Send a medicine request to a stockholder for " + centre(cid).name +
        ". Requesting multiple centres is handled by transfers where possible.",
      fields: [
        { name: "medId", label: "Medicine", type: "select", value: medId || "m_para",
          options: state.medicines.map(function (m) { return { value: m.id, label: m.name }; }) },
        { name: "qty", label: "Quantity", type: "number", min: 1, value: qty || 100, required: true },
        { name: "supplierId", label: "Stockholder", type: "select", value: "S1",
          options: state.suppliers.map(function (s) { return { value: s.id, label: s.name + " (rating " + s.rating + ")" }; }) },
        { name: "note", label: "Note", type: "textarea", value: "Shortage confirmed after transfer review." }
      ],
      submitLabel: "Send to stockholder",
      onSubmit: function (data) {
        const n = parseInt(data.qty, 10);
        if (!n || n < 1) { toast("Enter a valid quantity", "warn"); return false; }
        remoteOrLocal(
          function () {
            return CP_API.createSupply({
              medId: data.medId, qty: n, supplierId: data.supplierId, note: data.note
            });
          },
          function () { localRaiseSupply(cid, data.medId, n, data.supplierId, data.note); }
        );
      }
    });
  }

  function localRaiseSupply(cid, medId, n, supplierId, note) {
    const id = "SR-" + (2007 + state.supplyRequests.length + 1);
    const stamp = E.nowStamp();
    state.supplyRequests.push({
      id: id, centreId: cid, supplierId: supplierId, medId: medId, qty: n,
      status: "pending", eta: "", dispatchedQty: 0, note: note,
      events: [{ time: stamp, text: "Supply request raised to " + supplier(supplierId).name }]
    });
    toast("Supply request " + id + " sent to " + supplier(supplierId).name);
  }

  /* ================= STOCKHOLDER ================= */
  function renderStockholder() {
    const sid = state.ui.stockSupplier;
    const sup = supplier(sid);
    const assigned = state.supplyRequests.filter(function (r) { return r.supplierId === sid; })
      .sort(function (a, b) { return b.id.localeCompare(a.id); });
    const pending = assigned.filter(function (r) { return r.status === "pending"; });
    const accepted = assigned.filter(function (r) { return r.status === "accepted" || r.status === "partial"; });
    const dispatched = assigned.filter(function (r) { return r.status === "dispatched"; });

    const html =
      '<div class="page-head"><h1>' + esc(sup.name) + " — Stockholder console</h1>" +
      "<p>Receive medicine requests from PHCs only. Check stock and fulfilment capacity, then accept, " +
      "reject, or partially fulfil, and share expected delivery dates and dispatch updates.</p></div>" +

      '<div class="access-note" style="margin-bottom:20px"><span>Privacy:</span>' +
      "<span>You can see PHC identity, authorised supply requests, quantities, and delivery details. " +
      "Customer identities, prescriptions, contact information and customer-side records are not visible here.</span></div>" +

      '<div class="grid cols-4 section">' +
      statCard(pending.length, "New requests", pending.length ? "warn" : "") +
      statCard(accepted.length, "Accepted / pending dispatch") +
      statCard(dispatched.length, "In transit") +
      statCard(assigned.length, "Total assigned") +
      "</div>" +

      '<div class="section"><h2 class="section-title">Assigned supply requests (PHC → stockholder)</h2>' +
      '<div class="card"><div class="table-wrap"><table class="data"><thead><tr>' +
      "<th>Request</th><th>PHC</th><th>Medicine</th><th>Qty</th><th>Status</th><th>ETA</th><th>Actions</th>" +
      "</tr></thead><tbody>" +
      (assigned.length ? assigned.map(function (r) {
        const phc = centre(r.centreId);
        const actions = [];
        if (r.status === "pending") {
          actions.push('<button class="btn sm" data-sup-accept="' + r.id + '">Accept</button>');
          actions.push('<button class="btn sm ghost" data-sup-partial="' + r.id + '">Partial</button>');
          actions.push('<button class="btn sm danger" data-sup-reject="' + r.id + '">Reject</button>');
        } else if (r.status === "accepted" || r.status === "partial") {
          actions.push('<button class="btn sm" data-sup-dispatch="' + r.id + '">Dispatch</button>');
        } else if (r.status === "dispatched") {
          actions.push('<button class="btn sm soft" data-sup-receive="' + r.id + '">Confirm receipt</button>');
        } else {
          actions.push('<span class="hint">Closed</span>');
        }
        return "<tr><td><b>" + esc(r.id) + "</b></td>" +
          "<td>" + esc(phc.name) + '<div class="hint">' + esc(phc.area) + " · " + esc(phc.incharge) + "</div></td>" +
          "<td>" + esc(med(r.medId).name) + "</td><td>" + r.qty + "</td>" +
          "<td>" + supplyBadge(r.status) + "</td><td>" + esc(r.eta || "—") + "</td>" +
          "<td><div class=\"chips\">" + actions.join("") + "</div></td></tr>";
      }).join("") : '<tr><td colspan="7"><div class="empty">No supply requests assigned to this stockholder.</div></td></tr>') +
      "</tbody></table></div></div></div>" +

      '<div class="section"><h2 class="section-title">Dispatch &amp; delivery log</h2>' +
      '<div class="grid cols-2">' +
      (accepted.concat(dispatched).length ? accepted.concat(dispatched).map(function (r) {
        return '<div class="card"><div class="card-head"><div><h3>' + esc(r.id) + " — " +
          esc(med(r.medId).name) + "</h3><div class=\"card-sub\">" + esc(centre(r.centreId).name) +
          "</div></div>" + supplyBadge(r.status) + "</div>" +
          '<div class="card-body">' + timeline(r.events) + "</div></div>";
      }).join("") : '<div class="empty">Nothing accepted or dispatched yet.</div>') +
      "</div></div>";

    return html;
  }

  function wireStockholder() {
    document.querySelectorAll("[data-sup-accept]").forEach(function (b) {
      b.addEventListener("click", function () { supAccept(b.dataset.supAccept, "accepted"); });
    });
    document.querySelectorAll("[data-sup-partial]").forEach(function (b) {
      b.addEventListener("click", function () { supAccept(b.dataset.supPartial, "partial"); });
    });
    document.querySelectorAll("[data-sup-reject]").forEach(function (b) {
      b.addEventListener("click", function () { supReject(b.dataset.supReject); });
    });
    document.querySelectorAll("[data-sup-dispatch]").forEach(function (b) {
      b.addEventListener("click", function () { supDispatch(b.dataset.supDispatch); });
    });
    document.querySelectorAll("[data-sup-receive]").forEach(function (b) {
      b.addEventListener("click", function () { supReceive(b.dataset.supReceive); });
    });
  }

  function findSupply(id) { return state.supplyRequests.find(function (r) { return r.id === id; }); }

  function supAccept(id, kind) {
    const r = findSupply(id);
    const sup = supplier(r.supplierId);
    if (kind === "accepted") {
      formModal({
        title: "Accept request " + r.id,
        sub: med(r.medId).name + " × " + r.qty + " for " + centre(r.centreId).name,
        fields: [{ name: "eta", label: "Expected delivery date", type: "date", value: E.addDays(sup.leadTimeDays) }],
        submitLabel: "Accept",
        onSubmit: function (d) {
          remoteOrLocal(
            function () { return CP_API.supplyAction(id, { action: "accept", eta: d.eta }); },
            function () {
              r.status = "accepted"; r.eta = d.eta;
              r.events.push({ time: E.nowStamp(), text: sup.name + " accepted, expected " + d.eta });
              toast(r.id + " accepted, ETA " + d.eta);
            }
          );
        }
      });
    } else {
      formModal({
        title: "Partially fulfil " + r.id,
        sub: med(r.medId).name + " requested " + r.qty + " for " + centre(r.centreId).name,
        fields: [
          { name: "acceptedQty", label: "Quantity you can supply now", type: "number", min: 1, value: Math.max(1, Math.floor(r.qty / 2)) },
          { name: "eta", label: "Expected delivery date", type: "date", value: E.addDays(sup.leadTimeDays + 2) }
        ],
        submitLabel: "Send partial fulfilment",
        onSubmit: function (d) {
          const q = parseInt(d.acceptedQty, 10) || 0;
          if (!q || q < 1) { toast("Enter a valid quantity", "warn"); return false; }
          remoteOrLocal(
            function () { return CP_API.supplyAction(id, { action: "partial", qty: q, eta: d.eta }); },
            function () {
              r.status = "partial"; r.eta = d.eta; r.dispatchedQty = 0; r.acceptedQty = q;
              r.events.push({ time: E.nowStamp(), text: sup.name + " partially fulfilled " + q + " of " + r.qty + ", balance later" });
              toast(r.id + " partially fulfilled (" + q + "/" + r.qty + ")");
            }
          );
        }
      });
    }
  }

  function supReject(id) {
    const r = findSupply(id);
    formModal({
      title: "Reject request " + r.id,
      sub: "Provide a reason for " + centre(r.centreId).name + ".",
      fields: [{ name: "reason", label: "Reason", type: "text", value: "Insufficient stock / capacity" }],
      submitLabel: "Reject request",
      onSubmit: function (d) {
        remoteOrLocal(
          function () { return CP_API.supplyAction(id, { action: "reject", reason: d.reason }); },
          function () {
            r.status = "rejected";
            r.events.push({ time: E.nowStamp(), text: "Rejected by " + supplier(r.supplierId).name + ": " + d.reason });
            toast("Rejected " + r.id, "warn");
          }
        );
      }
    });
  }

  function supDispatch(id) {
    const r = findSupply(id);
    const max = r.acceptedQty || r.qty;
    formModal({
      title: "Dispatch " + r.id,
      sub: "Confirm the quantity dispatched to " + centre(r.centreId).name + ".",
      fields: [{ name: "qty", label: "Dispatched quantity", type: "number", min: 1, value: max }],
      submitLabel: "Mark dispatched",
      onSubmit: function (d) {
        const q = parseInt(d.qty, 10) || 0;
        if (!q || q < 1) { toast("Enter a valid quantity", "warn"); return false; }
        remoteOrLocal(
          function () { return CP_API.supplyAction(id, { action: "dispatch", qty: q }); },
          function () {
            r.status = "dispatched"; r.dispatchedQty = q;
            r.events.push({ time: E.nowStamp(), text: "Dispatched " + q + " " + med(r.medId).unit + "(s), in transit" });
            toast("Dispatched " + q + " for " + r.id);
          }
        );
      }
    });
  }

  function supReceive(id) {
    const r = findSupply(id);
    remoteOrLocal(
      function () { return CP_API.supplyAction(id, { action: "receive" }); },
      function () {
        const q = r.dispatchedQty || r.qty;
        state.stock[r.centreId][r.medId].qty += q;
        r.status = "delivered";
        r.events.push({ time: E.nowStamp(), text: "Receipt confirmed by " + centre(r.centreId).name + " (+" + q + " stock)" });
        toast("Delivery received: " + q + " added to " + centre(r.centreId).name);
      }
    );
  }

  /* ================= router ================= */
  function render() {
    renderTopbarMeta();

    const app = document.getElementById("app");
    if (state.ui.role === "customer") {
      app.innerHTML = renderCustomer();
      wireCustomer();
    } else if (state.ui.role === "phc") {
      app.innerHTML = renderPHC();
      wirePHC();
    } else {
      app.innerHTML = renderStockholder();
      wireStockholder();
    }
    document.getElementById("footNote").textContent =
      session.name + " · signed in as " + roleLabel(state.ui.role) +
      (live ? " · connected to server" : " · offline (local data)");
  }

  loadRemote().then(function () {
    render();
    if (session.role === "phc") {
      window.setInterval(refreshLiveState, 3000);
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") refreshLiveState();
      });
    }
  });
})();

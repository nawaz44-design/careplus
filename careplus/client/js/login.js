/* CarePlus login — role selection, credential check, session store */
(function () {
  "use strict";

  const SESSION_KEY = "careplus.session";
  const REG_KEY = "careplus.registered";

  const ACCOUNTS = {
    customer: [
      { u: "ravi", p: "care123", id: "cust1", name: "Ravi Kumar" },
      { u: "meera", p: "care123", id: "cust2", name: "Meera Joseph" },
      { u: "arun", p: "care123", id: "cust3", name: "Arun Das" }
    ],
    phc: [
      { u: "greenvalley", p: "phc123", id: "C1", name: "Green Valley PHC" },
      { u: "riverside", p: "phc123", id: "C2", name: "Riverside PHC" },
      { u: "hilltop", p: "phc123", id: "C3", name: "Hilltop PHC" },
      { u: "sunrise", p: "phc123", id: "C4", name: "Sunrise PHC" }
    ],
    stockholder: [
      { u: "medidist", p: "sup123", id: "S1", name: "MediDist Ltd" },
      { u: "pharmalink", p: "sup123", id: "S2", name: "PharmaLink Distributors" },
      { u: "healthcore", p: "sup123", id: "S3", name: "HealthCore Supplies" }
    ]
  };

  const BLURBS = {
    customer: "Search nearby medicine availability, upload a prescription and send requests to a PHC.",
    phc: "Pharmacist console: respond to customers, forecast shortages and approve centre-to-centre transfers.",
    stockholder: "Supplier console: fulfil authorised PHC supply requests and share delivery updates."
  };

  const LBL = {
    customer: "Select your account",
    phc: "Select your PHC centre",
    stockholder: "Select your supplier"
  };

  let role = "customer";

  const tabs = document.getElementById("loginRoleTabs");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const errorBox = document.getElementById("loginError");
  const demoChips = document.getElementById("demoChips");
  const roleBlurb = document.getElementById("roleBlurb");
  const assignedWrap = document.getElementById("assignedWrap");
  const assignedLabel = document.getElementById("assignedLabel");
  const assignedSel = document.getElementById("assignedSel");
  const form = document.getElementById("loginForm");

  function seedFor(roleName) {
    const s = window.CP_SEED;
    if (roleName === "phc") return s.centres.map(function (c) { return { id: c.id, name: c.name }; });
    if (roleName === "stockholder") return s.suppliers.map(function (s2) { return { id: s2.id, name: s2.name }; });
    return [];
  }

  function renderRole() {
    tabs.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.role === role);
    });
    roleBlurb.textContent = BLURBS[role];
    errorBox.hidden = true;

    const list = seedFor(role);
    if (list.length) {
      assignedWrap.hidden = false;
      assignedLabel.textContent = LBL[role];
      assignedSel.innerHTML = list.map(function (o) {
        return '<option value="' + o.id + '">' + o.name + "</option>";
      }).join("");
      syncAssignedToUsername();
    } else {
      assignedWrap.hidden = true;
      assignedSel.innerHTML = "";
    }

    demoChips.innerHTML = ACCOUNTS[role].filter(function (a) { return !a.registered; })
      .map(function (a) {
        return '<button type="button" class="demo-chip" data-u="' + a.u + '" data-p="' + a.p + '">' +
          a.u + " / " + a.p + "</button>";
      }).join("");

    demoChips.querySelectorAll(".demo-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        username.value = chip.dataset.u;
        password.value = chip.dataset.p;
        showError(false);
      });
    });
    username.value = "";
    password.value = "";
  }

  function syncAssignedToUsername() {
    const acc = ACCOUNTS[role].find(function (a) { return a.id === assignedSel.value; });
    if (acc) username.value = acc.u;
  }

  function showError(msg) {
    if (!msg) { errorBox.hidden = true; return; }
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  tabs.addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-role]");
    if (!btn) return;
    role = btn.dataset.role;
    renderRole();
  });

  assignedSel.addEventListener("change", syncAssignedToUsername);

  function goToApp(user) {
    const q = "?role=" + encodeURIComponent(user.role) +
      "&id=" + encodeURIComponent(user.id) +
      "&name=" + encodeURIComponent(user.name);
    window.location.href = "index.html" + q;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const u = username.value.trim().toLowerCase();
    const p = password.value;
    if (!u || !p) { showError("Please enter your username and password."); return; }

    /* Try the backend first. */
    if (window.CP_API) {
      try {
        const user = await CP_API.login(role, u, p);
        goToApp(user);
        return;
      } catch (err) {
        if (!err.offline) { showError(err.message); return; }
        /* backend unreachable -> fall back to local demo accounts below */
      }
    }

    const match = ACCOUNTS[role].find(function (a) { return a.u === u && a.p === p; });
    if (!match) {
      showError("Invalid credentials for the " + role + " role. Try a demo account below.");
      return;
    }
    const session = { role: role, id: match.id, name: match.name, username: match.u, at: Date.now() };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (err) { /* ignore */ }
    goToApp(session);
  });

  function loadRegistered() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(REG_KEY) || "[]"); } catch (e) { list = []; }
    list.forEach(function (a) {
      if (!ACCOUNTS[a.role]) return;
      const exists = ACCOUNTS[a.role].some(function (x) { return x.u === a.username; });
      if (exists) return;
      ACCOUNTS[a.role].push({ u: a.username, p: a.password, id: a.id, name: a.name, registered: true });
    });
  }

  loadRegistered();
  renderRole();
})();

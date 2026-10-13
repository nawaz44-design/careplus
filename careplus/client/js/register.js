/* CarePlus register — pharmacist (PHC) & stockholder onboarding (no customer registration) */
(function () {
  "use strict";

  const SESSION_KEY = "careplus.session";
  const REG_KEY = "careplus.registered";

  const BLURBS = {
    phc: "Pharmacist console: respond to customers, forecast shortages and approve centre-to-centre transfers.",
    stockholder: "Supplier console: fulfil authorised PHC supply requests and share delivery updates."
  };

  let role = "phc";

  const tabs = document.getElementById("regRoleTabs");
  const nameEl = document.getElementById("regName");
  const shopEl = document.getElementById("regShop");
  const licenceEl = document.getElementById("regLicence");
  const emailEl = document.getElementById("regEmail");
  const phoneEl = document.getElementById("regPhone");
  const assignEl = document.getElementById("regAssign");
  const passwordEl = document.getElementById("regPassword");
  const confirmEl = document.getElementById("regConfirm");
  const errorBox = document.getElementById("regError");

  const shopLabel = document.getElementById("shopLabel");
  const licLabel = document.getElementById("licLabel");
  const licHint = document.getElementById("licHint");
  const assignLabel = document.getElementById("assignLabel");
  const blurb = document.getElementById("regBlurb");
  const form = document.getElementById("regForm");

  const LICENSE_RE = /^[A-Za-z0-9][A-Za-z0-9\-\/ ]{4,}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function readRegistered() {
    try { return JSON.parse(localStorage.getItem(REG_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeRegistered(list) {
    try { localStorage.setItem(REG_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function seedOptions() {
    const s = window.CP_SEED;
    if (role === "phc") return s.centres.map(function (c) { return { id: c.id, name: c.name }; });
    return s.suppliers.map(function (x) { return { id: x.id, name: x.name }; });
  }

  function renderRole() {
    tabs.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.role === role);
    });
    blurb.textContent = BLURBS[role];
    errorBox.hidden = true;

    if (role === "phc") {
      shopLabel.textContent = "Shop / centre name";
      licHint.textContent = "Drug licence / PHC registration number of the shop.";
      licenceEl.placeholder = "e.g. DL-PHC-2026-00987";
      assignLabel.textContent = "Centre you operate";
    } else {
      shopLabel.textContent = "Shop / organisation name";
      licHint.textContent = "Drug distribution / trade licence number of the shop.";
      licenceEl.placeholder = "e.g. DL-DIST-2026-04321";
      assignLabel.textContent = "Supplier you operate";
    }
    licLabel.textContent = "Shop license number";

    assignEl.innerHTML = seedOptions().map(function (o) {
      return '<option value="' + o.id + '">' + o.name + "</option>";
    }).join("");
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

  function goToApp(user) {
    const q = "?role=" + encodeURIComponent(user.role) +
      "&id=" + encodeURIComponent(user.id) +
      "&name=" + encodeURIComponent(user.name);
    window.location.href = "index.html" + q;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const name = nameEl.value.trim();
    const shop = shopEl.value.trim();
    const licence = licenceEl.value.trim();
    const email = emailEl.value.trim();
    const phone = phoneEl.value.trim();
    const pass = passwordEl.value;

    if (!name || !shop || !licence || !email || !phone) {
      showError("Please fill in all fields."); return;
    }
    if (!LICENSE_RE.test(licence)) {
      showError("Enter a valid shop license number (at least 6 letters/digits, e.g. DL-PHC-2026-00987)."); return;
    }
    if (!EMAIL_RE.test(email)) {
      showError("Enter a valid email address."); return;
    }
    if (pass.length < 6) {
      showError("Password must be at least 6 characters."); return;
    }
    if (pass !== confirmEl.value) {
      showError("Passwords do not match."); return;
    }

    const username = email.toLowerCase();

    /* Try the backend first. */
    if (window.CP_API) {
      try {
        const user = await CP_API.register({
          role: role, name: name, shop: shop, licence: licence,
          email: email, phone: phone, password: pass, id: assignEl.value
        });
        goToApp(user);
        return;
      } catch (err) {
        if (!err.offline) { showError(err.message); return; }
        /* backend unreachable -> fall back to local storage below */
      }
    }

    const list = readRegistered();
    if (list.some(function (a) { return a.role === role && a.username === username; })) {
      showError("An account with this email is already registered for this role."); return;
    }

    const account = {
      role: role,
      username: username,
      password: pass,
      name: shop,
      contactName: name,
      licence: licence.toUpperCase(),
      email: email,
      phone: phone,
      id: assignEl.value,
      at: Date.now()
    };
    list.push(account);
    writeRegistered(list);

    const session = { role: role, id: account.id, name: account.name, username: username, licence: account.licence };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (err) { /* ignore */ }
    goToApp(session);
  });

  renderRole();
})();

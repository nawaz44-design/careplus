/* CarePlus drop-in feature: "Nearby shops" using the customer's GPS.
   Self-contained. To enable, add ONE line to client/index.html (see bottom of this file).

   >>> EDIT THE COORDINATES BELOW to match your real PHC/shop locations. <<< */
(function () {
  "use strict";

  /* Demo coordinates for the seeded centres. Replace lat/lng with real ones. */
  var CENTRE_COORDS = {
    C1: { lat: 12.9716, lng: 77.5946 },
    C2: { lat: 12.9520, lng: 77.6050 },
    C3: { lat: 13.0010, lng: 77.5700 },
    C4: { lat: 12.9350, lng: 77.5600 }
  };

  var DEFAULT_COORDS = { lat: 12.9716, lng: 77.5946 }; // used when GPS is unavailable/denied

  var lastCoords = null;
  var lastAccuracy = null;
  var lastSource = null;
  var lastResults = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toRad(d) { return (d * Math.PI) / 180; }

  function haversineKm(a, b) {
    var R = 6371;
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  function injectStyle() {
    if (document.getElementById("gpsNearbyStyle")) return;
    var st = document.createElement("style");
    styleId();
    st.id = "gpsNearbyStyle";
    st.textContent =
      "#gpsNearby .gps-status{font-size:13px;color:#4b5563;margin-top:8px}" +
      ".gps-locate{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}" +
      ".gps-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#1f7a4d}";
    document.head.appendChild(st);
  }
  function $(id) { return document.getElementById(id); }

  function isCustomerPage() {
    return !!$("custMed") && !!$("app");
  }

  function currentMedId() {
    var sel = $("custMed");
    return sel ? sel.value : null;
  }

  function ensureSection() {
    if (!isCustomerPage()) return null;
    var existing = $("gpsNearby");
    if (existing) return existing;

    var app = $("app");
    var section = document.createElement("div");
    section.id = "gpsNearby";
    section.className = "section";
    section.style.marginBottom = "8px";
    section.innerHTML =
      '<h2 class="section-title">Nearby shops (using your GPS)</h2>' +
      '<div class="card"><div class="card-body">' +
      '<div class="access-note ok" style="margin-bottom:14px"><span>Location:</span>' +
      "<span>Share your mobile location to find the closest PHC/shop and see live medicine availability before you travel.</span></div>" +
      '<div class="chips">' +
      '<button class="btn" id="gpsBtn">Use my current location</button>' +
      '<button class="btn ghost" id="gpsDefault">Use demo location</button>' +
      "</div>" +
      '<div class="hint mt-8" id="gpsStatus">Location not shared yet.</div>' +
      '<div class="mt-16"><div id="gpsResults"></div></div>' +
      "</div></div>";

    app.insertBefore(section, app.firstChild);

    $("gpsBtn").addEventListener("click", requestLocation);
    $("gpsDefault").addEventListener("click", function () {
      toCoords(DEFAULT_COORDS, null, "demo", "Demo location");
    });
    return section;
  }

  function setStatus(msg) {
    var el = $("gpsStatus");
    if (el) el.textContent = msg;
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setStatus("This device/browser does not support GPS. Showing demo location instead.");
      toCoords(DEFAULT_COORDS, null, "demo", "GPS not supported - demo location");
      return;
    }
    $("gpsBtn").disabled = true;
    $("gpsBtn").textContent = "Locating…";
    var status = $("gpsStatus");
    if (status) status.textContent = "Requesting your location…";

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var btn = $("gpsBtn");
        if (btn) { btn.disabled = false; btn.textContent = "Use my current location"; }
        toCoords(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          pos.coords.accuracy,
          "gps",
          "Located by your device"
        );
      },
      function (err) {
        var btn = $("gpsBtn");
        if (btn) { btn.disabled = false; btn.textContent = "Use my current location"; }
        var msg = "Could not get your location.";
        if (err && err.code === 1) msg = "Location permission denied - using a demo location instead.";
        else if (err && err.code === 2) msg = "Location unavailable - using a demo location instead.";
        else if (err && err.code === 3) msg = "Location timed out - using a demo location instead.";
        toCoords(DEFAULT_COORDS, null, "demo", msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function toCoords(coords, accuracy, source, message) {
    lastCoords = coords;
    lastAccuracy = accuracy;
    lastSource = source;
    var status = $("gpsStatus");
    if (status) {
      status.textContent = message + " · " + coords.lat.toFixed(5) + ", " + coords.lng.toFixed(5) +
        (accuracy ? " (±" + Math.round(accuracy) + " m)" : "");
    }
    refreshAvailability();
  }

  function distanceList() {
    var out = [];
    var centres = (window.CP_SEED && window.CP_SEED.centres) || [];
    centres.forEach(function (c) {
      var pos = CENTRE_COORDS[c.id];
      if (!pos || !lastCoords) return;
      out.push({ centre: c, pos: pos, km: haversineKm(lastCoords, pos) });
    });
    out.sort(function (a, b) { return a.km - b.km; });
    return out;
  }

  function refreshAvailability() {
    var box = $("gpsResultList") || $("gpsResults");
    if (!box) return;
    box.innerHTML = '<div class="hint">Checking nearby availability…</div>';

    var medId = currentMedId();
    var fetchState = function () {
      if (window.CP_API && CP_API.getState) return CP_API.getState();
      return Promise.reject(new Error("offline"));
    };

    fetchState().then(function (state) {
      render(box, state, medId);
    }).catch(function () {
      render(box, null, medId);
    });
  }

  function render(box, state, medId) {
    var list = distanceList();
    if (!lastCoords) {
      box.innerHTML = '<div class="hint">Tap “Use my current location” to find nearby shops.</div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty">No shop coordinates configured. Add them in client/js/nearme.js.</div>';
      return;
    }

    var avail = {};
    var medName = "";
    var unit = "unit";
    if (state && medId && window.CP_ENGINE) {
      var med = (state.medicines || []).filter(function (m) { return m.id === medId; })[0];
      if (med) { medName = med.name; unit = med.unit; }
      (window.CP_ENGINE.availability(state, medId) || []).forEach(function (r) {
        avail[r.centre.id] = r;
      });
    }

    lastResults = { list: list, avail: avail, medId: medId, medName: medName, unit: unit };

    var locCard =
      '<div class="card" style="margin-bottom:14px"><div class="card-body">' +
      '<div class="centre-top"><div>' +
      '<div class="centre-name">Your location' +
      (lastSource === "gps" ? " (device GPS)" : " (demo)") + "</div>" +
      '<div class="centre-meta">' + lastCoords.lat.toFixed(5) + ", " + lastCoords.lng.toFixed(5) +
      (lastAccuracy ? " · accurate to about ±" + Math.round(lastAccuracy) + " m" : "") + "</div></div>" +
      '<span class="pill ' + (lastSource === "gps" ? "green" : "grey") + '">' +
      (lastSource === "gps" ? "Live" : "Demo") + "</span></div>" +
      '<div class="chips mt-8"><a class="btn sm ghost" target="_blank" rel="noopener" href="' +
      "https://www.google.com/maps?q=" + lastCoords.lat + "," + lastCoords.lng +
      '">View my location on map</a></div>' +
      "</div></div>";

    box.innerHTML =
      locCard +
      '<div class="grid cols-3">' +
      list.map(function (item, i) {
        var c = item.centre;
        var a = avail[c.id];
        var availHtml = "";
        if (a) {
          availHtml =
            '<div class="stock-read"><b>' + a.entry.qty + '</b><span class="hint">' +
            esc(unit) + '(s) available</span></div>' +
            '<div class="avail-row"><span class="pill ' + a.cls + '">' + esc(a.label) + '</span>' +
            '<span class="hint">Approx. ' + a.m.coverage + ' day(s) left</span></div>';
        } else {
          availHtml = '<div class="hint mt-8">Availability not loaded.</div>';
        }
        var badge = i === 0 ? '<span class="pill green">Nearest</span>' : "";
        var maps = "https://www.google.com/maps/dir/?api=1&destination=" +
          item.pos.lat + "," + item.pos.lng;
        return '<div class="card"><div class="card-body centre-card">' +
          '<div class="centre-top"><div>' +
          '<div class="centre-name">' + esc(c.name) + '</div>' +
          '<div class="centre-meta">' + esc(c.area) + " · " + item.km.toFixed(1) + " km away · " +
          esc(c.phone) + '</div></div>' + (availHtml ? '<span class="pill blue">' +
          (i === 0 ? "Nearest" : "Shop") + '</span>' : "") + '</div>' +
          availHtml +
          '<div class="chips">' +
          '<a class="btn sm" href="tel:' + esc(String(c.phone).replace(/\s/g, "")) + '">Call PHC</a>' +
          '<a class="btn sm ghost" target="_blank" rel="noopener" href="' +
          "https://www.google.com/maps/dir/?api=1&destination=" + item.pos.lat + "," + item.pos.lng +
          '">Directions</a>' +
          "</div></div></div>";
      }).join("") +
      "</div>" +
      (medName ? '<div class="hint mt-16">Showing live availability for <b>' + esc(medName) +
        "</b>. Change the medicine above and search again.</div>" : "");
  }

  function inject() {
    if (!isCustomerPage()) return;
    var section = ensureSection();
    if (section && lastCoords) refreshAvailability();
  }

  function boot() {
    var app = $("app");
    if (app) {
      var obs = new MutationObserver(function () { inject(); });
      obs.observe(app, { childList: true });
    }
    inject();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

/* ── HOW TO ADD TO THE PROJECT ──────────────────────────────────────────
   1. This file lives at:  client/js/nearme.js
   2. Open  client/index.html  and add this ONE line AFTER app.js:

        <script src="../shared/data.js"></script>
        <script src="../shared/engine.js"></script>
        <script src="js/api.js"></script>
        <script src="js/app.js"></script>
        <script src="js/nearme.js"></script>   <-- ADD THIS

   3. Reload http://localhost:4000 and log in as a customer.
   4. Replace the demo coordinates in CENTRE_COORDS with your real shop GPS points.
   ─────────────────────────────────────────────────────────────────────── */

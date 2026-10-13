/* CarePlus engine — forecasting + transfer-first recommendation logic.
   Core rule: propose transfers between centres before district reorders. */
(function () {
  "use strict";

  function metrics(entry) {
    if (!entry) return null;
    const qty = entry.qty;
    const daily = Math.max(entry.daily, 0.0001);
    const safety = entry.safety;
    const lead = entry.lead;
    const deficit = Math.max(0, safety - qty);
    const surplus = Math.max(0, qty - safety);
    const coverage = qty / daily;                 // days of stock left
    const projectedUse = daily * lead;            // what will be consumed within lead time
    const required = Math.max(safety, projectedUse);
    const shortfall = Math.max(0, required - qty); // total needed to be safe
    let status = "ok";
    if (qty <= 0) status = "out";
    else if (qty < safety) status = "critical";
    else if (coverage < lead) status = "watch";
    return {
      qty, daily, safety, lead, deficit, surplus,
      coverage: Math.round(coverage * 10) / 10,
      shortfall, required, status
    };
  }

  function statusLabel(status) {
    return {
      out: "Out of stock",
      critical: "Critical",
      watch: "Watch",
      ok: "Adequate"
    }[status] || status;
  }

  function statusPill(status) {
    return {
      out: "red",
      critical: "red",
      watch: "amber",
      ok: "green"
    }[status] || "grey";
  }

  /* Shortage forecast for one centre, sorted by urgency. */
  function centreForecast(state, centreId) {
    const rows = state.medicines.map(function (med) {
      const entry = state.stock[centreId][med.id];
      const m = metrics(entry);
      return { med: med, entry: entry, m: m };
    });
    const atRisk = rows.filter(function (r) {
      return r.m.status === "out" || r.m.status === "critical" || r.m.status === "watch";
    });
    atRisk.sort(function (a, b) {
      const rank = { out: 0, critical: 1, watch: 2 };
      const d = rank[a.m.status] - rank[b.m.status];
      if (d !== 0) return d;
      return a.m.coverage - b.m.coverage;
    });
    return { all: rows, atRisk: atRisk };
  }

  function hasOpenSupplyRequest(state, centreId, medId) {
    return state.supplyRequests.some(function (r) {
      return r.centreId === centreId && r.medId === medId &&
        ["pending", "accepted", "partial", "dispatched"].indexOf(r.status) !== -1;
    });
  }

  /* Transfer-first recommendation:
     1. For every centre+medicine that is short, look across ALL other centres
        for a genuine surplus (stock above that centre's own safety level).
     2. Move stock from surplus centres to the short centre and show the effect
        on BOTH centres (before -> after).
     3. Only the remaining, uncovered shortfall becomes a district reorder. */
  function recommend(state) {
    const transfers = [];
    const reorders = [];

    state.centres.forEach(function (receiver) {
      state.medicines.forEach(function (med) {
        const recEntry = state.stock[receiver.id][med.id];
        const recM = metrics(recEntry);
        if (!(recM.status === "out" || recM.status === "critical" || recM.status === "watch")) return;

        let need = Math.round(recM.shortfall);
        if (need <= 0) return;

        const donorPool = state.centres
          .filter(function (c) { return c.id !== receiver.id; })
          .map(function (donor) {
            const dEntry = state.stock[donor.id][med.id];
            const dM = metrics(dEntry);
            return { donor: donor, entry: dEntry, m: dM, give: Math.floor(dM.surplus) };
          })
          .filter(function (p) { return p.give > 0; })
          .sort(function (a, b) {
            if (b.give !== a.give) return b.give - a.give;
            return a.donor.distanceKm - b.donor.distanceKm;
          });

        const origNeed = need;
        donorPool.forEach(function (p) {
          if (need <= 0) return;
          const move = Math.min(need, p.give);
          if (move <= 0) return;
          transfers.push({
            id: "TR-" + receiver.id + "-" + med.id + "-" + p.donor.id,
            medId: med.id,
            receiverId: receiver.id,
            donorId: p.donor.id,
            qty: move,
            receiver: {
              before: recM.qty,
              after: recM.qty + move,
              needed: origNeed,
              safety: recM.safety,
              coverageBefore: recM.coverage,
              coverageAfter: Math.round(((recM.qty + move) / Math.max(recM.daily, 0.0001)) * 10) / 10
            },
            donor: {
              before: p.m.qty,
              after: p.m.qty - move,
              surplusBefore: Math.floor(p.m.surplus),
              surplusAfter: Math.floor(p.m.surplus) - move,
              safety: p.m.safety
            },
            reason: "Covers " + Math.round((move / origNeed) * 100) + "% of " +
              receiver.name + "'s " + med.name + " shortfall"
          });
          need -= move;
        });

        const covered = origNeed - need;
        if (need > 0) {
          reorders.push({
            id: "RO-" + receiver.id + "-" + med.id,
            centreId: receiver.id,
            medId: med.id,
            shortfall: origNeed,
            coveredByTransfer: covered,
            reorderQty: need,
            hasOpenRequest: hasOpenSupplyRequest(state, receiver.id, med.id),
            reason: covered > 0
              ? "Transfers cover " + covered + "; " + need + " still short — reorder from district"
              : "No centre has surplus — reorder from district"
          });
        }
      });
    });

    transfers.sort(function (a, b) {
      const sev = { out: 0, critical: 1, watch: 2 };
      const rm = state.stock[a.receiverId][a.medId];
      const rn = state.stock[b.receiverId][b.medId];
      return sev[metrics(rn).status] - sev[metrics(rm).status];
    });

    return { transfers: transfers, reorders: reorders };
  }

  /* Public availability for a customer medicine query. */
  function availability(state, medId) {
    return state.centres.map(function (c) {
      const entry = state.stock[c.id][medId];
      const m = metrics(entry);
      let label, cls;
      if (m.qty <= 0) { label = "Out of stock"; cls = "red"; }
      else if (m.status === "critical") { label = "Low stock"; cls = "amber"; }
      else { label = "In stock"; cls = "green"; }
      return { centre: c, entry: entry, m: m, label: label, cls: cls };
    }).sort(function (a, b) {
      const order = { green: 0, amber: 1, red: 2 };
      if (order[a.cls] !== order[b.cls]) return order[a.cls] - order[b.cls];
      return a.centre.distanceKm - b.centre.distanceKm;
    });
  }

  function nextId(prefix, existing) {
    let n = 1;
    const ids = existing.map(function (x) { return x.id; });
    let candidate;
    do {
      candidate = prefix + "-" + String(n).padStart(4, "0");
      n++;
    } while (ids.indexOf(candidate) !== -1);
    return candidate;
  }

  function nowStamp() {
    const d = new Date();
    const p = function (v) { return String(v).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function addDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const p = function (v) { return String(v).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  const API = {
    metrics: metrics,
    statusLabel: statusLabel,
    statusPill: statusPill,
    centreForecast: centreForecast,
    recommend: recommend,
    availability: availability,
    hasOpenSupplyRequest: hasOpenSupplyRequest,
    nextId: nextId,
    nowStamp: nowStamp,
    addDays: addDays
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.CP_ENGINE = API;
})();

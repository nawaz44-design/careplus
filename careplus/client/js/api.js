/* CarePlus API client — talks to the Express backend, with graceful offline fallback. */
(function () {
  "use strict";

  const TOKEN_KEY = "careplus.token";
  const SESSION_KEY = "careplus.session";

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY) || null; } catch (e) { token = null; }

  function setToken(t) {
    token = t || null;
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  async function req(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method: method,
        headers: Object.assign({ "Content-Type": "application/json" },
          token ? { Authorization: "Bearer " + token } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (networkErr) {
      const err = new Error("offline");
      err.offline = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || ("Request failed (" + res.status + ")"));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function saveSession(user) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch (e) { /* ignore */ }
  }

  const api = {
    hasToken: function () { return !!token; },
    clear: function () {
      setToken(null);
      try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    },

    async login(role, username, password) {
      const r = await req("POST", "/api/auth/login", { role: role, username: username, password: password });
      setToken(r.token);
      saveSession(r.user);
      return r.user;
    },

    async register(payload) {
      const r = await req("POST", "/api/auth/register", payload);
      setToken(r.token);
      saveSession(r.user);
      return r.user;
    },

    async getState() {
      const r = await req("GET", "/api/state");
      return r.state;
    },

    async customerRequest(p) {
      const r = await req("POST", "/api/customer/requests", p);
      return r.state;
    },
    async respondRequest(id, p) {
      const r = await req("POST", "/api/phc/customer-requests/" + encodeURIComponent(id) + "/respond", p);
      return r.state;
    },
    async approveTransfer(p) {
      const r = await req("POST", "/api/phc/transfers/approve", p);
      return r.state;
    },
    async createSupply(p) {
      const r = await req("POST", "/api/phc/supply-requests", p);
      return r.state;
    },
    async supplyAction(id, p) {
      const r = await req("POST", "/api/supply-requests/" + encodeURIComponent(id) + "/action", p);
      return r.state;
    }
  };

  if (typeof window !== "undefined") window.CP_API = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();

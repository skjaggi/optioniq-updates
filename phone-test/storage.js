// Where the phone app reads the phone copy and drops its changes.
//
// Every place works the same way (see tracker/phone.py on the computer):
//   readCopy()        -> the computer's Phone/phone-copy.json, parsed
//   writeChange(op)   -> one small file in Phone/inbox
// The phone never reads or writes the main data file.
(function (root) {
  "use strict";

  function fileName(op) {
    return String(op.at || new Date().toISOString()).replace(/[^0-9T]/g, "").slice(0, 15) + "-" + op.opId + ".json";
  }

  // ---- Sample data: try every screen before any cloud drive is connected ----
  function sample() {
    var d = new Date(), iso = function (n) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
      return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
    };
    // Expiries land on a Friday, like real ones, so live prices can be looked up.
    var fri = function (n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return iso(n + (5 - x.getDay() + 7) % 7); };
    var S = root.OptionIQSums, rows = [
      [1, "IRA", "AAPL", "P", "S", "180", "183.10", 2, "1.20", 2, -9],
      [2, "IRA", "MSFT", "C", "S", "420", "405.30", 5, "2.10", 1, -12],
      [3, "Roth", "KO", "P", "S", "62", "60.40", 9, "0.85", 3, -20],
      [4, "Roth", "PLTR", "P", "S", "150", "171.00", 23, "3.40", 1, -5],
      [5, "IRA", "SOFI", "C", "S", "28", "26.50", 37, "0.95", 4, -3]
    ];
    var trades = rows.map(function (r) {
      var t = { id: r[0], account: r[1], ticker: r[2], cp: r[3], sb: r[4], strike: r[5], currentStock: r[6],
                expDate: fri(r[7]), sellPremium: r[8], contracts: String(r[9]), date: iso(r[10]), company: "",
                action: "Open", closeDate: "", closePremium: "" };
      t.total = S.calcSells(t.sb, t.sellPremium, t.contracts) + S.calcBuys(t.sb, t.sellPremium, t.contracts);
      t.netPL = t.total; t.moneyOnHold = S.calcMOH(t);
      return t;
    });
    var done = { id: 6, account: "IRA", ticker: "AMD", cp: "P", sb: "S", strike: "150", currentStock: "162",
                 expDate: iso(-4), sellPremium: "2.00", contracts: "1", date: iso(-30), company: "",
                 action: "Expired", closeDate: iso(-4), closePremium: "" };
    done.total = S.calcSells("S", "2.00", "1"); done.netPL = done.total; done.moneyOnHold = 0;
    trades.push(done);
    var bought = { id: 7, account: "IRA", ticker: "NVDA", cp: "C", sb: "B", strike: "140", currentStock: "143.20",
                   expDate: fri(16), sellPremium: "2.00", contracts: "1", date: iso(-6), company: "",
                   action: "Open", closeDate: "", closePremium: "" };
    bought.total = S.calcSells("B", "2.00", "1") + S.calcBuys("B", "2.00", "1"); bought.netPL = bought.total; bought.moneyOnHold = 0;
    trades.push(bought);
    // Made-up option prices, as the computer would send them after 🔄 Prices.
    var at = Date.now() - 50 * 60000, px = function (p) { return { price: p, mid: true, at: at }; };
    var optionPrices = { at: new Date(at).toISOString(), target: 80,
                         prices: { 1: px(0.95), 2: px(0.15), 3: px(1.60), 4: px(0.30), 5: px(0.12), 7: px(3.10) } };
    // Made-up summary cards, as the computer would send them.
    var card = function (period, k) {
      var M = period === "month";
      return { period: period, total: 2486.4 * k, periodPL: (M ? 734.2 : 198.66) * k,
               prem: { puts: (M ? 1630.1 : 466.1) * k, calls: (M ? 412.5 : 207.3) * k, total: (M ? 2042.6 : 673.4) * k },
               avg: (M ? 612.4 : 141.3) * k, units: M ? 4.1 : 17.6, since: iso(-123), open: 1265.3 * k,
               openCount: Math.round(5 * k), closedCount: Math.round(31 * k), hold: Math.round(69600 * k) };
    };
    var both = function (k) { return { week: card("week", k), month: card("month", k) }; };
    var summary = { at: new Date(Date.now() - 50 * 60000).toISOString(), all: both(1),
                    accounts: { IRA: both(0.6), Roth: both(0.4) } };
    return {
      version: 1, sample: true, summary: summary, optionPrices: optionPrices, writtenAt: new Date(Date.now() - 50 * 60000).toISOString(),
      accounts: ["IRA", "Roth"], reminderDays: 7, finnhubKey: "", appliedOps: [],
      trades: trades,
      stocks: [{ id: 50, account: "Roth", ticker: "KO", company: "Coca-Cola", shares: "200", dateAcquired: iso(-60),
                 costBasis: "64", currentPrice: "60.40", status: "Assigned" },
               { id: 51, account: "IRA", ticker: "AAPL", company: "Apple", shares: "50", dateAcquired: iso(-400),
                 costBasis: "172.50", currentPrice: "231.10", status: "Held" },
               { id: 52, account: "IRA", ticker: "NVDA", company: "NVIDIA", shares: "120", dateAcquired: iso(-200),
                 costBasis: "118", currentPrice: "137.80", status: "Held" },
               { id: 53, account: "Roth", ticker: "PFE", company: "Pfizer", shares: "300", dateAcquired: iso(-500),
                 costBasis: "34.20", currentPrice: "28.90", status: "Held" }],
      // Made-up "today" prices for Refresh prices (sample data has no Finnhub key).
      quotes: { KO: { c: 60.92, d: 0.52, dp: 0.86 }, AAPL: { c: 229.35, d: -1.75, dp: -0.76 },
                NVDA: { c: 139.6, d: 1.8, dp: 1.31 }, PFE: { c: 28.71, d: -0.19, dp: -0.66 },
                MSFT: { c: 421.5, d: 3.1, dp: 0.74 } },
      watchlist: [{ ticker: "AAPL", name: "Apple" }, { ticker: "NVDA", name: "NVIDIA" }, { ticker: "KO", name: "Coca-Cola" }]
    };
  }

  var SampleStore = {
    id: "sample",
    name: "Sample data",
    signedIn: function () { return true; },
    readCopy: function () {
      return Promise.resolve(sample());
    },
    // Nothing to send: sample changes stay "waiting for computer" on the phone.
    writeChange: function () { return Promise.resolve(); }
  };

  // ---- OneDrive (Microsoft Graph), signed in with the person's own account ----
  var MS = {
    clientId: "9e9a14af-db05-4a9c-a891-943437c1c106",   // "OptionIQ Phone" app registered by Quantum Nexus LLC. (not a secret)
    authority: "https://login.microsoftonline.com/common/oauth2/v2.0",
    scope: "Files.ReadWrite offline_access User.Read",
    graph: "https://graph.microsoft.com/v1.0"
  };

  function redirectUri() { return location.origin + location.pathname.replace(/[^/]*$/, ""); }
  function b64url(bytes) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomText(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }

  var OneDrive = {
    id: "onedrive",
    name: "OneDrive",
    ready: function () { return !!MS.clientId; },
    signedIn: function () { return !!localStorage.getItem("oiq_od_refresh"); },
    folder: function () { return localStorage.getItem("oiq_od_folder") || ""; },
    setFolder: function (id, path) { localStorage.setItem("oiq_od_folder", id); localStorage.setItem("oiq_od_path", path); },
    folderPath: function () { return localStorage.getItem("oiq_od_path") || ""; },

    signIn: function () {
      var verifier = randomText(48), state = randomText(16);
      sessionStorage.setItem("oiq_pkce", verifier);
      sessionStorage.setItem("oiq_state", state);
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then(function (h) {
        location.href = MS.authority + "/authorize?" + new URLSearchParams({
          client_id: MS.clientId, response_type: "code", redirect_uri: redirectUri(), scope: MS.scope,
          code_challenge: b64url(h), code_challenge_method: "S256", state: state, prompt: "select_account"
        });
      });
    },

    // Back from Microsoft's sign-in page with ?code=...
    finishSignIn: function () {
      var q = new URLSearchParams(location.search);
      if (!q.get("code")) return Promise.resolve(false);
      history.replaceState(null, "", location.pathname);
      if (q.get("state") !== sessionStorage.getItem("oiq_state")) return Promise.reject(new Error("Sign-in didn't match. Please try again."));
      return this._token({ grant_type: "authorization_code", code: q.get("code"),
                           code_verifier: sessionStorage.getItem("oiq_pkce") }).then(function () { return true; });
    },

    signOut: function () {
      ["oiq_od_refresh", "oiq_od_access", "oiq_od_expires", "oiq_od_folder", "oiq_od_path"].forEach(function (k) { localStorage.removeItem(k); });
    },

    _token: function (extra) {
      var body = new URLSearchParams(Object.assign({ client_id: MS.clientId, redirect_uri: redirectUri(), scope: MS.scope }, extra));
      return fetch(MS.authority + "/token", { method: "POST", body: body }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            if (extra.grant_type === "refresh_token") localStorage.removeItem("oiq_od_refresh");
            throw new Error("signin");
          }
          localStorage.setItem("oiq_od_access", j.access_token);
          localStorage.setItem("oiq_od_expires", String(Date.now() + (j.expires_in - 120) * 1000));
          if (j.refresh_token) localStorage.setItem("oiq_od_refresh", j.refresh_token);
          return j.access_token;
        });
      });
    },

    _access: function () {
      if (Number(localStorage.getItem("oiq_od_expires") || 0) > Date.now()) return Promise.resolve(localStorage.getItem("oiq_od_access"));
      var rt = localStorage.getItem("oiq_od_refresh");
      if (!rt) return Promise.reject(new Error("signin"));
      return this._token({ grant_type: "refresh_token", refresh_token: rt });
    },

    _call: function (path, opts) {
      return this._access().then(function (tok) {
        opts = opts || {};
        opts.headers = Object.assign({ Authorization: "Bearer " + tok }, opts.headers || {});
        return fetch(MS.graph + path, opts).then(function (r) {
          if (r.status === 401) { localStorage.removeItem("oiq_od_expires"); throw new Error("signin"); }
          if (!r.ok) throw new Error("OneDrive answered " + r.status);
          return r;
        });
      });
    },

    // Folder picker: the folders inside one folder ("" = top of OneDrive).
    listFolders: function (id) {
      var path = id ? "/me/drive/items/" + id + "/children" : "/me/drive/root/children";
      return this._call(path + "?$select=id,name,folder,file&$top=200").then(function (r) { return r.json(); })
        .then(function (j) {
          var kids = j.value || [];
          return {
            folders: kids.filter(function (k) { return k.folder; }).map(function (k) { return { id: k.id, name: k.name }; })
              .sort(function (a, b) { return a.name.localeCompare(b.name); }),
            hasPhoneFolder: kids.some(function (k) { return k.folder && k.name === "Phone"; }),
            hasData: kids.some(function (k) { return k.file && k.name === "tracker_data.json"; })
          };
        });
    },

    readCopy: function () {
      return this._call("/me/drive/items/" + this.folder() + ":/Phone/phone-copy.json:/content", { cache: "no-store" })
        .then(function (r) { return r.json(); });
    },

    writeChange: function (op) {
      return this._call("/me/drive/items/" + this.folder() + ":/Phone/inbox/" + fileName(op) + ":/content", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op)
      });
    }
  };

  root.OptionIQStores = { sample: SampleStore, onedrive: OneDrive, MS: MS, fileName: fileName };
})(window);

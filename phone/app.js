// OptionIQ phone app: a pocket companion to OptionIQ on the computer.
//
// What it shows comes from the computer's phone copy (storage.js). Every
// change made here (new trade, close, roll, fix, delete) is kept in a local
// "pending" list and sent to the cloud folder's Phone/inbox, where OptionIQ on
// the computer adds it to the records. Until the computer has added it, the
// phone shows it with the same sums (phone_inbox.js + sums.js), marked
// "waiting for computer".
(function () {
  "use strict";

  var VERSION = "1.0";
  var TERMS_VERSION = "2";
  var Sums = window.OptionIQSums, Phone = window.OptionIQPhone, Stores = window.OptionIQStores;

  // ---- small helpers --------------------------------------------------------
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }
  function keep(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or private */ } }
  function esc(s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function num(v) { var n = parseFloat(String(v === undefined || v === null ? "" : v).replace(/[$,\s]/g, "")); return isNaN(n) ? null : n; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nowLocal() { var d = new Date(); return today() + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
  function daysUntil(iso) { return Math.round((new Date(iso + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000); }
  function money(v, cents) {
    var n = Number(v) || 0;
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents === false ? 0 : 2, maximumFractionDigits: cents === false ? 0 : 2 });
  }
  function shortDate(iso) {
    if (!iso) return "";
    var d = new Date(iso.slice(0, 10) + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + (d.getFullYear() !== new Date().getFullYear() ? ", " + d.getFullYear() : "");
  }
  function timeOf(stamp) {
    if (!stamp) return "";
    var d = new Date(stamp), same = d.toDateString() === new Date().toDateString();
    return (same ? "today " : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " ") +
           d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function kind(t) { return (t.cp === "C" ? "call" : "put") + (t.sb === "B" ? " (bought)" : ""); }
  function title(t) { return esc(t.ticker) + " $" + esc(t.strike) + " " + kind(t); }

  // ---- state ----------------------------------------------------------------
  var settings = load("oiq_settings", { store: "sample", nearPct: 3, lock: false, terms: "" });
  var copy = load("oiq_copy_" + settings.store, null);
  var pending = load("oiq_pending_" + settings.store, []);
  var prices = load("oiq_prices", { at: "", q: {} });
  var ui = { tab: "home", account: "All", search: "", closed: false, sheet: null, busy: "", problem: "", locked: !!settings.lock };

  function store() { return Stores[settings.store] || Stores.sample; }
  function saveState() {
    keep("oiq_settings", settings);
    keep("oiq_pending_" + settings.store, pending);
  }

  // The records as the phone should show them: the computer's copy plus any
  // phone changes it hasn't added yet, worked out with the logger's own sums.
  function view() {
    if (!copy) return null;
    var applied = {};
    (copy.appliedOps || []).forEach(function (id) { applied[id] = true; });
    var waiting = pending.filter(function (op) { return !applied[op.opId]; });
    var names = {};
    (copy.watchlist || []).forEach(function (w) { if (w.name) names[w.ticker] = w.name; });
    (copy.trades || []).forEach(function (t) { if (t.company) names[t.ticker] = t.company; });
    var watch = {};
    (copy.watchlist || []).forEach(function (w) { watch[w.ticker] = w.name || ""; });
    var r = Phone.applyPhoneOps(copy.trades || [], copy.stocks || [], waiting, {
      calcSells: Sums.calcSells, calcBuys: Sums.calcBuys, calcMOH: Sums.calcMOH, calcNetPL: Sums.calcNetPL,
      tickerName: function (tk) { return names[tk] || ""; }, watchlist: watch
    }, []);
    var marks = {};
    waiting.forEach(function (op) {
      if (op.op === "watch") { marks["w:" + String(op.ticker).toUpperCase()] = op.uploaded ? "waiting" : "not sent"; return; }
      var id = op.op === "new" ? op.trade.id : op.id;
      marks[String(id)] = op.uploaded ? "waiting" : "not sent";
      if (op.roll) marks[String(op.roll.id)] = marks[String(id)];
    });
    return { trades: r.trades, stocks: r.stocks.filter(function (s) { return (s.status || "Held") !== "Sold"; }),
             watchlist: Object.keys(r.watchlist).sort().map(function (k) { return { ticker: k, name: r.watchlist[k] }; }),
             marks: marks, waiting: waiting, notes: r.notes };
  }

  function stockPrice(t) {
    var q = prices.q[t.ticker];
    return q && q.c ? q.c : num(t.currentStock);
  }

  // In the money / near strike / out of the money, from the stock's price.
  function moneyness(t) {
    var px = stockPrice(t), k = num(t.strike);
    if (!px || !k) return { tag: "", label: "No price", pct: null };
    var pct = (px - k) / k * 100;
    var itm = t.cp === "P" ? px < k : px > k;
    var near = Math.abs(pct) <= (Number(settings.nearPct) || 3);
    return { itm: itm, near: near, pct: pct, px: px,
             tag: itm ? "itm" : near ? "near" : "otm", label: itm ? "In the money" : near ? "Near strike" : "Out of money" };
  }

  function risk(t) {
    var m = moneyness(t), d = daysUntil(t.expDate);
    return t.sb === "S" && (m.itm || m.near) && d <= Math.max(7, copy.reminderDays || 7);
  }

  // ---- changes made on the phone ------------------------------------------
  function change(op) {
    op.v = 1; op.opId = uid(); op.at = nowLocal(); op.device = "phone"; op.uploaded = false;
    pending.push(op);
    saveState();
    ui.sheet = null;
    render();
    sync();
  }

  var syncing = false;
  function sync() {
    if (syncing) return Promise.resolve();
    var st = store();
    if (st.id !== "sample" && (!st.signedIn() || !st.folder())) { render(); return Promise.resolve(); }
    syncing = true; ui.busy = "Syncing…"; render();
    var unsent = pending.filter(function (op) { return !op.uploaded; });
    var chain = Promise.resolve();
    unsent.forEach(function (op) {
      chain = chain.then(function () {
        var clean = Object.assign({}, op); delete clean.uploaded;
        return st.writeChange(clean).then(function () { op.uploaded = true; saveState(); });
      });
    });
    return chain.then(function () { return st.readCopy(); }).then(function (c) {
      copy = c;
      keep("oiq_copy_" + settings.store, copy);
      var applied = {};
      (copy.appliedOps || []).forEach(function (id) { applied[id] = true; });
      pending = pending.filter(function (op) { return !applied[op.opId]; });
      saveState();
      ui.problem = "";
    }).catch(function (e) {
      ui.problem = e && e.message === "signin" ? "signin"
        : navigator.onLine === false ? "You're offline. Changes will be sent when you're back online."
        : "Couldn't reach " + st.name + ". Showing what was saved last. (" + (e && e.message || e) + ")";
    }).then(function () { syncing = false; ui.busy = ""; render(); });
  }

  // ---- live prices (the person's own Finnhub key, from the computer) -------
  function refreshPrices() {
    var key = copy && copy.finnhubKey;
    if (!key) { alert("No Finnhub key yet. Enter it once in OptionIQ on your computer (🔑 Set Key); it reaches the phone on the next sync."); return; }
    var v = view(), set = {};
    v.trades.filter(Sums.isOpen).forEach(function (t) { set[t.ticker] = 1; });
    v.stocks.forEach(function (s) { set[s.ticker] = 1; });
    v.watchlist.forEach(function (w) { set[w.ticker] = 1; });
    var tickers = Object.keys(set).filter(Boolean), done = 0, failed = [];
    ui.busy = "Getting prices…"; render();
    var next = function () {
      var tk = tickers.shift();
      if (!tk) return Promise.resolve();
      return fetch("https://finnhub.io/api/v1/quote?symbol=" + encodeURIComponent(tk) + "&token=" + encodeURIComponent(key), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { if (j && j.c) { prices.q[tk] = { c: j.c, dp: j.dp }; done++; } else failed.push(tk); })
        .catch(function () { failed.push(tk); })
        .then(next);
    };
    Promise.all([next(), next(), next()]).then(function () {
      if (done) prices.at = new Date().toISOString();
      keep("oiq_prices", prices);
      ui.busy = "";
      ui.problem = failed.length && !done ? "Couldn't get prices from Finnhub. Check your internet connection." : "";
      render();
    });
  }

  // ---- phone calendar --------------------------------------------------------
  function addToCalendar(list) {
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Quantum Nexus LLC.//OptionIQ Phone//EN", "CALSCALE:GREGORIAN"];
    var stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    list.forEach(function (t) {
      var d = t.expDate.replace(/-/g, ""), end = new Date(t.expDate + "T00:00:00");
      end.setDate(end.getDate() + 1);
      lines.push("BEGIN:VEVENT", "UID:optioniq-" + String(t.id).replace(/\W/g, "") + "@optioniq", "DTSTAMP:" + stamp,
        "DTSTART;VALUE=DATE:" + d,
        "DTEND;VALUE=DATE:" + end.getFullYear() + pad(end.getMonth() + 1) + pad(end.getDate()),
        "SUMMARY:" + t.ticker + " $" + t.strike + " " + (t.cp === "C" ? "call" : "put") + " expires (" + t.account + ")",
        "DESCRIPTION:Reminder from OptionIQ", "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + t.ticker + " option expires in 2 days",
        "TRIGGER:-PT39H", "END:VALARM", "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    var blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = list.length === 1 ? list[0].ticker + "-expiry.ics" : "OptionIQ-expiries.ics";
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- Face ID / passcode lock (the phone's own, via passkey) --------------
  function b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function challenge() { var a = new Uint8Array(32); crypto.getRandomValues(a); return a; }

  function turnLockOn() {
    if (!window.PublicKeyCredential) { alert("This phone's browser can't use Face ID for web apps."); return; }
    navigator.credentials.create({ publicKey: {
      challenge: challenge(), rp: { name: "OptionIQ" },
      user: { id: challenge(), name: "OptionIQ", displayName: "OptionIQ" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60000 } }).then(function (cred) {
      settings.lock = b64(cred.rawId); saveState(); render();
    }).catch(function () { alert("Face ID wasn't turned on."); });
  }

  function unlock() {
    navigator.credentials.get({ publicKey: {
      challenge: challenge(), allowCredentials: [{ type: "public-key", id: unb64(settings.lock) }],
      userVerification: "required", timeout: 60000 } }).then(function () {
      ui.locked = false; render(); sync();
    }).catch(function () { /* stay locked; the button is still there */ });
  }

  var hiddenAt = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (settings.lock && hiddenAt && Date.now() - hiddenAt > 60000) { ui.locked = true; render(); }
    else if (!ui.locked) sync();
  });

  // ---- screens ----------------------------------------------------------------
  var app = document.getElementById("app");

  function header(main, sub) {
    return '<header><div class="brand"><img src="icon-192.png" alt=""><div><h1>' + main + '</h1>' +
           (sub ? '<p class="sub">' + sub + "</p>" : "") + "</div></div></header>";
  }

  function accountChips(v) {
    var accts = ["All"].concat(copy.accounts || []);
    return '<div class="chips">' + accts.map(function (a) {
      return '<button class="chip' + (ui.account === a ? " on" : "") + '" data-act="acct" data-v="' + esc(a) + '">' + esc(a) + "</button>";
    }).join("") + "</div>";
  }

  function inAccount(r) { return ui.account === "All" || r.account === ui.account; }

  function tagHtml(t) {
    if (!Sums.isOpen(t)) return '<span class="tag done">' + esc(t.action) + "</span>";
    var m = moneyness(t);
    return m.tag ? '<span class="tag ' + m.tag + '">' + m.label + "</span>" : "";
  }

  function tradeCard(t, v) {
    var open = Sums.isOpen(t), d = daysUntil(t.expDate), m = moneyness(t), mark = v.marks[String(t.id)];
    var line2 = open
      ? (d < 0 ? "Expired " + (-d) + " day" + (d === -1 ? "" : "s") + " ago" : d === 0 ? "Expires today" : d + " day" + (d === 1 ? "" : "s") + " left") +
        (m.px ? ", stock " + money(m.px) : "")
      : "Closed " + shortDate(t.closeDate) + ", P&L " + money(t.netPL);
    var line3 = (open && m.pct !== null ? Math.abs(m.pct).toFixed(1) + "% " + (m.pct >= 0 ? "above" : "below") + " strike · " : "") +
                esc(t.account) + ", " + esc(t.contracts) + " contract" + (String(t.contracts) === "1" ? "" : "s");
    return '<button class="card trade ' + (open && risk(t) ? "risk" : "") + '" data-act="open-trade" data-id="' + esc(t.id) + '">' +
      '<div class="row"><b>' + title(t) + "</b>" + tagHtml(t) + "</div>" +
      '<div class="muted">' + line2 + "</div>" +
      '<div class="muted">' + line3 + "</div>" +
      (open && risk(t) ? '<div class="warn">Assignment risk</div>' : "") +
      (mark ? '<div class="pend">' + (mark === "waiting" ? "⏳ Waiting for computer" : "📤 Not sent yet") + "</div>" : "") +
      "</button>";
  }

  function homeScreen(v) {
    var mine = v.trades.filter(inAccount), open = mine.filter(Sums.isOpen);
    var month = today().slice(0, 7);
    var prem = mine.filter(function (t) { return String(t.date || "").slice(0, 7) === month; })
                   .reduce(function (a, t) { return a + (Number(t.total) || 0); }, 0);
    var held = open.reduce(function (a, t) { return a + (Number(t.moneyOnHold) || 0); }, 0);
    var soon = open.filter(function (t) { var d = daysUntil(t.expDate); return d >= 0 && d <= 2; });
    var accts = (copy.accounts || []).length;
    var h = header("OptionIQ", copy.sample ? "Sample data, not your trades" : "Prices as of " + esc(timeOf(prices.at || copy.writtenAt)));
    h += accountChips(v);
    if (soon.length) h += '<button class="card banner" data-act="tab" data-v="trades"><b>' + soon.length + " trade" + (soon.length > 1 ? "s" : "") + " expire" + (soon.length > 1 ? "" : "s") + " within 2 days</b></button>";
    h += '<div class="card"><div class="muted">Premium this month</div><div class="big">' + money(prem) + "</div></div>";
    h += '<div class="card"><div class="muted">Open trades</div><div class="big">' + open.length + (ui.account === "All" && accts > 1 ? " in " + accts + " accounts" : "") + "</div></div>";
    h += '<div class="card"><div class="muted">Money held for puts</div><div class="big">' + money(held, false) + "</div></div>";
    if (v.waiting.length) h += '<div class="card"><div class="muted">Waiting for computer</div><div class="big">' + v.waiting.length + " change" + (v.waiting.length > 1 ? "s" : "") + "</div><div class='muted small'>Added next time OptionIQ is open on your computer.</div></div>";
    h += '<div class="actions"><button class="btn primary" data-act="prices">Refresh prices</button></div>';
    if (prices.at) h += '<p class="muted small center">Live stock prices from Finnhub, ' + esc(timeOf(prices.at)) + ". Profit and loss from your computer, " + esc(timeOf(copy.writtenAt)) + ".</p>";
    return h;
  }

  function tradesScreen(v) {
    var q = ui.search.trim().toUpperCase();
    var list = v.trades.filter(inAccount).filter(function (t) {
      return (ui.closed || Sums.isOpen(t)) && (!q || String(t.ticker).toUpperCase().indexOf(q) === 0);
    }).sort(function (a, b) {
      var ao = Sums.isOpen(a), bo = Sums.isOpen(b);
      if (ao !== bo) return ao ? -1 : 1;
      return ao ? String(a.expDate).localeCompare(String(b.expDate)) : String(b.closeDate).localeCompare(String(a.closeDate));
    });
    var h = header("Trades", "All open, soonest first");
    h += '<div class="tools"><input id="search" type="search" placeholder="Find a ticker" value="' + esc(ui.search) + '" autocapitalize="characters">' +
         '<label class="switch"><input type="checkbox" data-act="closed"' + (ui.closed ? " checked" : "") + "> Closed (90 days)</label></div>";
    h += accountChips(v);
    h += list.length ? list.map(function (t) { return tradeCard(t, v); }).join("") : '<p class="muted center">No trades to show.</p>';
    var openOnes = list.filter(Sums.isOpen);
    if (openOnes.length) h += '<div class="actions"><button class="btn" data-act="cal-all">Add expiries to calendar</button></div>';
    return h;
  }

  function holdingsScreen(v) {
    var list = v.stocks.filter(inAccount);
    var h = header("Holdings", "Stocks you own");
    h += accountChips(v);
    h += list.length ? list.map(function (s) {
      var px = prices.q[s.ticker] && prices.q[s.ticker].c || num(s.currentPrice), cost = num(s.costBasis), sh = num(s.shares) || 0;
      var gain = px && cost ? (px - cost) * sh : null;
      return '<div class="card"><div class="row"><b>' + esc(s.ticker) + "</b><span>" + (px ? money(px) : "") + "</span></div>" +
        '<div class="muted">' + esc(sh) + " shares at " + money(cost) + (s.status === "Assigned" ? ", assigned" : "") + " · " + esc(s.account) + "</div>" +
        (gain !== null ? '<div class="' + (gain >= 0 ? "up" : "down") + '">' + (gain >= 0 ? "+" : "") + money(gain) + "</div>" : "") + "</div>";
    }).join("") : '<p class="muted center">No stocks held.</p>';
    h += '<p class="muted small center">Stock buys and sells are entered on the computer. Shares from an assignment appear here automatically.</p>';
    return h;
  }

  function watchScreen(v) {
    var list = v.watchlist;
    var h = header("Watchlist", prices.at ? "Prices " + esc(timeOf(prices.at)) : "Tap Refresh prices for live prices");
    h += list.length ? list.map(function (w) {
      var q = prices.q[w.ticker];
      return '<div class="card"><div class="row"><b>' + esc(w.ticker) + "</b><span>" + (q && q.c ? money(q.c) : "") + "</span></div>" +
        '<div class="row"><span class="muted">' + esc(w.name) + "</span>" +
        (q && q.dp !== undefined && q.dp !== null ? '<span class="' + (q.dp >= 0 ? "up" : "down") + '">' + (q.dp >= 0 ? "+" : "") + Number(q.dp).toFixed(2) + "%</span>" : "") + "</div>" +
        (v.marks["w:" + w.ticker] ? '<div class="pend">' + (v.marks["w:" + w.ticker] === "waiting" ? "⏳ Waiting for computer" : "📤 Not sent yet") + "</div>" : "") + "</div>";
    }).join("") : '<p class="muted center">Your watchlist is empty. Tap + to add a stock.</p>';
    h += '<div class="actions"><button class="btn primary" data-act="prices">Refresh prices</button></div>';
    return h;
  }

  function moreScreen() {
    var st = store(), h = header("Settings", "");
    h += '<div class="card"><div class="muted">Your data comes from</div><div class="row"><b>' + esc(st.name) + "</b>" +
         '<button class="btn small" data-act="choose-store">Change</button></div>';
    if (st.id === "onedrive") {
      h += st.signedIn() ? '<div class="muted small">Folder: ' + esc(st.folderPath() || "not chosen yet") + "</div>" +
           '<div class="row gap"><button class="btn small" data-act="pick-folder">Choose folder</button><button class="btn small" data-act="signout">Sign out</button></div>'
        : '<button class="btn primary" data-act="signin">Sign in to OneDrive</button>';
    }
    h += "</div>";
    h += '<div class="card"><label class="field">Warn when the stock is within this % of the strike<input id="nearPct" type="number" inputmode="decimal" min="0.5" max="20" step="0.5" value="' + esc(settings.nearPct) + '"></label></div>';
    h += '<div class="card"><div class="row"><b>Face ID to open</b><label class="switch"><input type="checkbox" data-act="lock"' + (settings.lock ? " checked" : "") + "></label></div>" +
         '<div class="muted small">Uses your phone\'s Face ID or passcode every time OptionIQ opens.</div></div>';
    h += '<div class="card"><div class="muted small">Expiry reminders: OptionIQ adds each expiry to your phone\'s calendar with an alert 2 days before. On the Trades tab, tap <b>Add expiries to calendar</b>.</div></div>';
    h += '<p class="muted small center">OptionIQ Phone ' + VERSION + (copy && copy.appVersion ? " · computer app " + esc(copy.appVersion) : "") +
         '<br><a href="terms.txt" target="_blank">Terms of Use</a></p>';
    return h;
  }

  // ---- pop-up sheets --------------------------------------------------------
  function sheet(inner) { return '<div class="veil" data-act="close-sheet"></div><div class="sheet" role="dialog">' + inner + "</div>"; }

  function options(list, cur) {
    return list.map(function (o) {
      var val = Array.isArray(o) ? o[0] : o, label = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(val) + '"' + (String(val) === String(cur) ? " selected" : "") + ">" + esc(label) + "</option>";
    }).join("");
  }

  function watchForm() {
    return sheet("<h2>Add to watchlist</h2>" +
      '<form id="watch-form">' +
      '<label class="field">Stock symbol<input name="ticker" autocapitalize="characters" autocomplete="off" placeholder="e.g. AAPL"></label>' +
      '<label class="field">Company name (optional)<input name="name" autocomplete="off" placeholder="e.g. Apple"></label>' +
      '<p class="muted small">It joins your watchlist on the computer the next time OptionIQ is open there.</p>' +
      '<p class="err" id="form-err"></p>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" type="submit">Add</button></div></form>');
  }

  function tradeForm(t, isEdit) {
    var v = view(), tickers = {};
    v.trades.forEach(function (x) { tickers[x.ticker] = 1; });
    (copy.watchlist || []).forEach(function (w) { tickers[w.ticker] = 1; });
    var closed = isEdit && !Sums.isOpen(t);
    return sheet('<h2>' + (isEdit ? "Fix " + title(t) : "New trade") + "</h2>" +
      '<form id="trade-form" data-id="' + esc(isEdit ? t.id : "") + '">' +
      '<label class="field">Account<select name="account">' + options(copy.accounts || [], t.account) + "</select></label>" +
      '<label class="field">Stock<input name="ticker" list="tickers" autocapitalize="characters" autocomplete="off" value="' + esc(t.ticker) + '" placeholder="e.g. AAPL"></label>' +
      '<datalist id="tickers">' + Object.keys(tickers).sort().map(function (k) { return '<option value="' + esc(k) + '">'; }).join("") + "</datalist>" +
      '<label class="field">Type<select name="type">' + options([["PS", "Put, sold"], ["CS", "Call, sold"], ["PB", "Put, bought"], ["CB", "Call, bought"]], (t.cp || "P") + (t.sb || "S")) + "</select></label>" +
      '<div class="two"><label class="field">Strike $<input name="strike" inputmode="decimal" value="' + esc(t.strike) + '"></label>' +
      '<label class="field">Expiry<input name="expDate" type="date" value="' + esc(t.expDate) + '"></label></div>' +
      '<div class="two"><label class="field">Premium $ per share<input name="sellPremium" inputmode="decimal" value="' + esc(t.sellPremium) + '"></label>' +
      '<label class="field">Contracts<input name="contracts" inputmode="numeric" value="' + esc(t.contracts || "1") + '"></label></div>' +
      '<label class="field">Date opened<input name="date" type="date" value="' + esc(t.date || today()) + '"></label>' +
      (closed ? '<div class="two"><label class="field">Close date<input name="closeDate" type="date" value="' + esc(t.closeDate) + '"></label>' +
                '<label class="field">Close amount $ (negative if paid)<input name="closePremium" inputmode="decimal" value="' + esc(t.closePremium) + '"></label></div>' : "") +
      '<p class="err" id="form-err"></p>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" type="submit">' + (isEdit ? "Save fix" : "Save trade") + "</button></div></form>");
  }

  function readTradeForm(f) {
    var g = function (n) { return f.elements[n] ? f.elements[n].value.trim() : ""; };
    var type = g("type");
    var t = { account: g("account"), ticker: g("ticker").toUpperCase(), cp: type[0], sb: type[1], strike: g("strike").replace(/[$,]/g, ""),
              expDate: g("expDate"), sellPremium: g("sellPremium").replace(/[$,]/g, ""), contracts: g("contracts"), date: g("date") };
    if (f.elements.closeDate) { t.closeDate = g("closeDate"); t.closePremium = g("closePremium").replace(/[$,]/g, ""); }
    var problems = [];
    if (!t.ticker) problems.push("the stock");
    if (num(t.strike) === null) problems.push("the strike");
    if (!t.expDate) problems.push("the expiry date");
    if (num(t.sellPremium) === null) problems.push("the premium");
    if (!(parseInt(t.contracts, 10) > 0)) problems.push("the number of contracts");
    if (problems.length) return { error: "Please fill in " + problems.join(", ") + "." };
    return { trade: t };
  }

  function tradeSheet(t) {
    var open = Sums.isOpen(t), m = moneyness(t), mark = view().marks[String(t.id)];
    var rows = [["Account", t.account], ["Opened", shortDate(t.date)], ["Expiry", shortDate(t.expDate) + (open ? " (" + daysUntil(t.expDate) + " days)" : "")],
                ["Contracts", t.contracts], ["Premium", money(t.sellPremium) + " per share, " + money(t.total) + " total"]];
    if (open && m.px) rows.push(["Stock now", money(m.px) + ", " + Math.abs(m.pct).toFixed(1) + "% " + (m.pct >= 0 ? "above" : "below") + " strike"]);
    if (!open) rows.push(["Closed", esc(t.action) + " on " + shortDate(t.closeDate)], ["Net P&L", money(t.netPL)]);
    var buttons = open
      ? '<button class="btn primary" data-act="close-form" data-id="' + esc(t.id) + '">Close or roll</button>' +
        '<button class="btn" data-act="quick" data-how="Expired" data-id="' + esc(t.id) + '">Expired</button>' +
        (t.sb === "S" ? '<button class="btn" data-act="quick" data-how="' + (t.cp === "P" ? "Assigned" : "Called Away") + '" data-id="' + esc(t.id) + '">' + (t.cp === "P" ? "Assigned" : "Called away") + "</button>" : "")
      : "";
    return sheet("<h2>" + title(t) + " " + tagHtml(t) + "</h2>" +
      (mark ? '<p class="pend">' + (mark === "waiting" ? "⏳ Waiting for computer" : "📤 Not sent yet") + "</p>" : "") +
      '<dl class="facts">' + rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>" +
      (open && risk(t) ? '<p class="warn">Assignment risk: the stock is ' + (m.itm ? "past" : "close to") + " your strike with " + daysUntil(t.expDate) + " days left.</p>" : "") +
      '<div class="actions wrap">' + buttons +
      '<button class="btn" data-act="edit" data-id="' + esc(t.id) + '">Fix</button>' +
      (open ? '<button class="btn" data-act="cal-one" data-id="' + esc(t.id) + '">Add to calendar</button>' : "") +
      (t.fromPhone ? '<button class="btn danger" data-act="delete" data-id="' + esc(t.id) + '">Delete</button>' : "") +
      '<button class="btn" data-act="close-sheet">Done</button></div>');
  }

  function closeForm(t) {
    var back = t.sb === "S" ? "Bought back" : "Sold";
    return sheet("<h2>Close " + title(t) + "</h2>" +
      '<form id="close-form" data-id="' + esc(t.id) + '">' +
      '<label class="field">How<select name="how" id="close-how">' + options([["back", back], ["roll", "Rolled (close and open a new one)"]], "back") + "</select></label>" +
      '<div class="two"><label class="field">Date<input name="closeDate" type="date" value="' + today() + '"></label>' +
      '<label class="field">Price $ per share<input name="price" inputmode="decimal" placeholder="e.g. 0.35"></label></div>' +
      '<div id="roll-part" hidden><h3>New trade</h3><div class="two"><label class="field">New strike $<input name="rStrike" inputmode="decimal" value="' + esc(t.strike) + '"></label>' +
      '<label class="field">New expiry<input name="rExp" type="date"></label></div>' +
      '<div class="two"><label class="field">New premium $ per share<input name="rPrem" inputmode="decimal"></label>' +
      '<label class="field">Contracts<input name="rQty" inputmode="numeric" value="' + esc(t.contracts) + '"></label></div></div>' +
      '<p class="muted small" id="close-total"></p><p class="err" id="form-err"></p>' +
      '<div class="actions"><button type="button" class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" type="submit">Save</button></div></form>');
  }

  // The exact dollar amount, as the Close dialog on the computer expects it:
  // negative when paid, positive when received, with the same $0.67 per contract.
  function closeAmount(t, price) {
    var q = parseInt(t.contracts, 10) || 1, gross = price * q * 100, fee = 0.67 * q;
    return (t.sb === "S" ? -(gross + fee) : gross - fee).toFixed(2);
  }

  function storeSheet() {
    return sheet("<h2>Where is your OptionIQ data?</h2>" +
      '<p class="muted small">Pick the cloud drive that holds your OptionIQ "My Data" folder.</p>' +
      '<div class="actions col"><button class="btn primary" data-act="use-store" data-v="onedrive">OneDrive</button>' +
      '<button class="btn" disabled>Google Drive (coming soon)</button><button class="btn" disabled>Dropbox (coming soon)</button>' +
      '<button class="btn" data-act="use-store" data-v="sample">Sample data (try it out)</button>' +
      '<button class="btn" data-act="close-sheet">Cancel</button></div>');
  }

  function folderSheet(trail, res) {
    var here = trail.length ? trail[trail.length - 1] : null;
    return sheet("<h2>Choose your My Data folder</h2>" +
      '<p class="muted small">' + esc(["OneDrive"].concat(trail.map(function (x) { return x.name; })).join(" › ")) + "</p>" +
      (res.hasPhoneFolder ? '<button class="btn primary" data-act="use-folder">Use this folder</button>' :
        res.hasData ? '<p class="warn">This is your data folder, but OptionIQ on your computer hasn\'t made its phone copy yet. Update OptionIQ, open it once, then try again.</p>' : "") +
      '<div class="list">' + (trail.length ? '<button class="item" data-act="folder-up">‹ Back</button>' : "") +
      res.folders.map(function (f) { return '<button class="item" data-act="folder-in" data-id="' + esc(f.id) + '" data-name="' + esc(f.name) + '">📁 ' + esc(f.name) + "</button>"; }).join("") +
      "</div>" + '<div class="actions"><button class="btn" data-act="close-sheet">Cancel</button></div>');
  }

  var trail = [];
  function browse() {
    var here = trail.length ? trail[trail.length - 1].id : "";
    ui.busy = "Opening OneDrive…";
    if (ui.sheet) ui.sheet = sheet('<h2>Choose your My Data folder</h2><p class="muted">Opening OneDrive…</p>');
    render();
    Stores.onedrive.listFolders(here).then(function (res) { ui.busy = ""; ui.sheet = folderSheet(trail, res); render(); })
      .catch(function (e) { ui.busy = ""; ui.sheet = null; ui.problem = e.message === "signin" ? "signin" : "Couldn't open OneDrive: " + e.message; render(); });
  }

  // ---- first start ------------------------------------------------------------
  function termsScreen() {
    return '<div class="welcome">' + header("OptionIQ", "by Quantum Nexus LLC.") +
      '<div class="card"><p>Your pocket companion to OptionIQ on your computer: log and close trades, see what expires soon, check live prices.</p>' +
      '<p class="muted small">Your trades stay in your own cloud drive. Quantum Nexus LLC. does not receive your information. Not financial advice.</p></div>' +
      '<iframe class="terms" src="terms.txt" title="Terms of Use"></iframe>' +
      '<label class="agree"><input type="checkbox" id="agree"> I agree to the Terms of Use</label>' +
      '<div class="actions"><button class="btn primary" data-act="agree">Continue</button></div></div>';
  }

  function lockScreen() {
    return '<div class="welcome center">' + header("OptionIQ", "Locked") +
      '<div class="actions"><button class="btn primary" data-act="unlock">Unlock with Face ID</button></div></div>';
  }

  // ---- render -----------------------------------------------------------------
  function render() {
    var scroll = app.querySelector("main") ? app.querySelector("main").scrollTop : 0;
    if (settings.terms !== TERMS_VERSION) { app.innerHTML = termsScreen(); return; }
    if (ui.locked && settings.lock) { app.innerHTML = lockScreen(); return; }
    var v = view(), body;
    if (!v && ui.tab === "more") body = moreScreen();
    else if (!v) body = header("OptionIQ", "") + '<p class="muted center">' + (ui.busy || "Choose where your OptionIQ data is to get started.") + "</p>" +
      (ui.busy ? "" : '<div class="actions"><button class="btn primary" data-act="tab" data-v="more">Choose my data</button></div>');
    else body = ui.tab === "trades" ? tradesScreen(v) : ui.tab === "holdings" ? holdingsScreen(v) : ui.tab === "watch" ? watchScreen(v) : ui.tab === "more" ? moreScreen() : homeScreen(v);
    var problem = ui.problem === "signin" ? '<button class="notice" data-act="signin">Your OneDrive sign-in has ended. Tap to sign in again.</button>'
      : ui.problem ? '<div class="notice">' + esc(ui.problem) + "</div>" : "";
    var tabs = [["home", "Home"], ["trades", "Trades"], ["holdings", "Stocks"], ["watch", "Watch"], ["more", "More"]];
    app.innerHTML = '<main>' + problem + (ui.busy ? '<div class="busy">' + esc(ui.busy) + "</div>" : "") + body +
      '<footer>© 2026 Quantum Nexus LLC. All rights reserved.</footer></main>' +
      // + logs a trade on Home and Trades, adds a stock on Watch; not shown elsewhere.
      (v && (ui.tab === "home" || ui.tab === "trades") ? '<button class="fab" data-act="new" aria-label="New trade">+</button>' : "") +
      (v && ui.tab === "watch" ? '<button class="fab" data-act="watch-add" aria-label="Add to watchlist">+</button>' : "") +
      '<nav>' + tabs.map(function (t) { return '<button data-act="tab" data-v="' + t[0] + '" class="' + (ui.tab === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</nav>" +
      (ui.sheet || "");
    if (app.querySelector("main")) app.querySelector("main").scrollTop = scroll;
  }

  function findTrade(id) { var v = view(); return v ? v.trades.filter(function (t) { return String(t.id) === String(id); })[0] : null; }

  // ---- taps ---------------------------------------------------------------------
  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act"), id = el.getAttribute("data-id"), val = el.getAttribute("data-v");
    if (el.tagName === "INPUT") return; // switches are handled on change
    var t = id && !/^folder-/.test(act) ? findTrade(id) : null;
    switch (act) {
      case "tab": ui.tab = val; ui.sheet = null; render(); app.querySelector("main").scrollTop = 0; break;
      case "acct": ui.account = val; render(); break;
      case "prices": refreshPrices(); break;
      case "new": ui.sheet = tradeForm({ account: ui.account !== "All" ? ui.account : (copy.accounts || [])[0] }, false); render(); break;
      case "watch-add": ui.sheet = watchForm(); render(); break;
      case "open-trade": if (t) { ui.sheet = tradeSheet(t); render(); } break;
      case "edit": if (t) { ui.sheet = tradeForm(t, true); render(); } break;
      case "close-form": if (t) { ui.sheet = closeForm(t); render(); } break;
      case "close-sheet": ui.sheet = null; render(); break;
      case "quick":
        if (t && confirm(el.getAttribute("data-how") === "Expired" ? "Mark " + t.ticker + " $" + t.strike + " as expired?"
            : el.getAttribute("data-how") === "Assigned" ? "Mark as assigned? " + ((parseInt(t.contracts, 10) || 1) * 100) + " " + t.ticker + " shares will be added to " + t.account + " at $" + t.strike + "."
            : "Mark as called away? " + ((parseInt(t.contracts, 10) || 1) * 100) + " " + t.ticker + " shares in " + t.account + " will be sold at $" + t.strike + ".")) {
          change({ op: "close", id: t.id, action: el.getAttribute("data-how"), closeDate: today() });
        }
        break;
      case "delete": if (t && confirm("Delete " + t.ticker + " $" + t.strike + "? This can't be undone on the phone.")) change({ op: "delete", id: t.id }); break;
      case "cal-one": if (t) addToCalendar([t]); break;
      case "cal-all": addToCalendar(view().trades.filter(inAccount).filter(Sums.isOpen).filter(function (x) { return daysUntil(x.expDate) >= 0; })); break;
      case "choose-store": ui.sheet = storeSheet(); render(); break;
      case "use-store":
        settings.store = val; saveState();
        copy = load("oiq_copy_" + val, null); pending = load("oiq_pending_" + val, []);
        ui.sheet = null; ui.problem = "";
        if (val === "onedrive") {
          if (!Stores.onedrive.ready()) { ui.problem = "OneDrive isn't switched on in this version yet."; render(); break; }
          if (!Stores.onedrive.signedIn()) { Stores.onedrive.signIn(); break; }
          if (!Stores.onedrive.folder()) { trail = []; browse(); break; }
        }
        sync(); break;
      case "signin": Stores.onedrive.signIn(); break;
      case "signout": if (confirm("Sign out of OneDrive? Your trades are removed from this phone (they stay in OneDrive).")) {
        Stores.onedrive.signOut(); localStorage.removeItem("oiq_copy_onedrive"); copy = null; render(); } break;
      case "pick-folder": trail = []; browse(); break;
      case "folder-in": trail.push({ id: id, name: el.getAttribute("data-name") }); browse(); break;
      case "folder-up": trail.pop(); browse(); break;
      case "use-folder":
        var here = trail[trail.length - 1];
        Stores.onedrive.setFolder(here.id, trail.map(function (x) { return x.name; }).join(" › "));
        ui.sheet = null; sync(); break;
      case "agree":
        if (!document.getElementById("agree").checked) { alert("Please tick the box to agree to the Terms of Use."); break; }
        settings.terms = TERMS_VERSION; saveState(); render(); sync(); break;
      case "unlock": unlock(); break;
    }
  });

  app.addEventListener("change", function (e) {
    var act = e.target.getAttribute("data-act");
    if (act === "closed") { ui.closed = e.target.checked; render(); }
    if (act === "lock") {
      if (e.target.checked) turnLockOn();
      else { settings.lock = false; saveState(); render(); }
    }
    if (e.target.id === "nearPct") { var n = num(e.target.value); if (n && n > 0) { settings.nearPct = n; saveState(); } }
    if (e.target.id === "close-how") {
      document.getElementById("roll-part").hidden = e.target.value !== "roll";
    }
  });

  app.addEventListener("input", function (e) {
    if (e.target.id === "search") {
      ui.search = e.target.value; render();
      var s = document.getElementById("search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
    }
    if (e.target.form && e.target.form.id === "close-form" && e.target.name === "price") {
      var t = findTrade(e.target.form.getAttribute("data-id")), p = num(e.target.value);
      document.getElementById("close-total").textContent = p === null ? "" : (t.sb === "S" ? "You paid " : "You received ") + money(Math.abs(closeAmount(t, p))) + " including fees.";
    }
  });

  app.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = e.target, err = document.getElementById("form-err");
    if (f.id === "trade-form") {
      var r = readTradeForm(f);
      if (r.error) { err.textContent = r.error; return; }
      var id = f.getAttribute("data-id");
      if (!id) {
        if (daysUntil(r.trade.expDate) < 0) { err.textContent = "The expiry date has already passed."; return; }
        r.trade.id = Date.now() + Math.random();
        change({ op: "new", trade: r.trade });
      } else {
        var cur = findTrade(id), changes = {}, base = {};
        Object.keys(r.trade).forEach(function (k) {
          if (String(r.trade[k]) !== String(cur[k] === undefined ? "" : cur[k])) { changes[k] = r.trade[k]; base[k] = cur[k] === undefined ? "" : cur[k]; }
        });
        if (!Object.keys(changes).length) { ui.sheet = null; render(); return; }
        change({ op: "edit", id: cur.id, changes: changes, base: base });
      }
    }
    if (f.id === "watch-form") {
      var tk = f.elements.ticker.value.trim().toUpperCase().replace(/^\$/, "");
      if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(tk)) { err.textContent = "Please enter a stock symbol, like AAPL."; return; }
      if (view().watchlist.some(function (w) { return w.ticker === tk; })) { err.textContent = tk + " is already on your watchlist."; return; }
      change({ op: "watch", ticker: tk, name: f.elements.name.value.trim() });
    }
    if (f.id === "close-form") {
      var t = findTrade(f.getAttribute("data-id")), g = function (n) { return f.elements[n].value.trim(); };
      var price = num(g("price")), how = g("how"), when = g("closeDate") || today();
      if (price === null) { err.textContent = "Please enter the price per share."; return; }
      var op = { op: "close", id: t.id, action: how === "roll" ? "Rolled" : t.sb === "S" ? "Bought to Close" : "Sold to Close",
                 closeDate: when, closePremium: closeAmount(t, price) };
      if (how === "roll") {
        var rs = num(g("rStrike")), rp = num(g("rPrem")), rq = parseInt(g("rQty"), 10), re = g("rExp");
        if (rs === null || rp === null || !(rq > 0) || !re) { err.textContent = "To roll, fill in the new strike, expiry, premium and contracts."; return; }
        if (re <= when) { err.textContent = "The new expiry must be after the close date."; return; }
        op.roll = { id: Date.now() + Math.random(), strike: String(rs), expDate: re, premium: String(rp), contracts: String(rq) };
      }
      change(op);
    }
  });

  // ---- start ----------------------------------------------------------------------
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () { /* works without */ });
  Stores.onedrive.finishSignIn().then(function (back) {
    if (back) {
      settings.store = "onedrive"; saveState();
      copy = load("oiq_copy_onedrive", null); pending = load("oiq_pending_onedrive", []);
      if (!Stores.onedrive.folder()) { render(); trail = []; browse(); return; }
    }
    render();
    if (!ui.locked) sync();
    if (ui.locked) unlock();
  }).catch(function (e) { ui.problem = e.message; render(); });
  setInterval(function () { if (!document.hidden && !ui.locked) sync(); }, 5 * 60000);
})();

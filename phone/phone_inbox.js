// Adds changes made on the OptionIQ phone app to the records.
//
// The phone never edits the data file. Each change it makes (a new trade, a
// close or roll, a fix, a delete, a ticker added to the watchlist) arrives as one small file in My Data\Phone\
// inbox (see tracker/phone.py). The trade screen calls applyPhoneOps with the
// current trades and holdings; the result is saved the same way as a change
// typed on the computer, using the logger's own sums (passed in as `h`) so a
// trade logged on the phone is indistinguishable from one logged here.
//
// Pure: no saving, no dialogs, no clock except op.at. Tested by
// tests/phone_inbox_test.js.
(function (root) {
  "use strict";

  var EDITABLE = ["account", "date", "company", "ticker", "strike", "currentStock", "expDate",
                  "sellPremium", "contracts", "cp", "sb", "closeDate", "closePremium"];
  var CLOSE_ACTIONS = ["Expired", "Assigned", "Called Away", "Bought to Close", "Sold to Close", "Rolled"];

  function str(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function day(v) { return /^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : ""; }
  function num(v) { var n = parseFloat(str(v)); return isNaN(n) ? null : n; }
  function isOpen(t) { return !t.action || t.action === "Open"; }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDay(v) { var d = day(v); return d ? MONTHS[+d.slice(5, 7) - 1] + " " + (+d.slice(8, 10)) : ""; }
  function dollars(v) {
    var n = Number(v) || 0;
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function contractsText(t) { var q = parseInt(t.contracts, 10) || 1; return q + " contract" + (q > 1 ? "s" : ""); }
  var FIELD_NAMES = { account: "account", date: "open date", company: "company", ticker: "stock", strike: "strike",
                      currentStock: "stock price", expDate: "expiry", sellPremium: "premium", contracts: "contracts",
                      cp: "put/call", sb: "sold/bought", closeDate: "close date", closePremium: "close amount" };
  function shown(k, v) {
    return k === "expDate" || k === "date" || k === "closeDate" ? shortDay(v) || "blank"
         : k === "closePremium" ? (str(v) === "" ? "blank" : dollars(v))
         : k === "strike" || k === "sellPremium" || k === "currentStock" ? "$" + str(v)
         : k === "cp" ? (v === "C" ? "call" : "put") : k === "sb" ? (v === "B" ? "bought" : "sold") : str(v) || "blank";
  }

  function label(t) {
    return str(t.ticker).toUpperCase() + " $" + str(t.strike) + " " + (t.cp === "C" ? "call" : "put") +
           (t.account ? " (" + t.account + ")" : "");
  }

  // The same totals the ＋ New Trade form and inline edit work out.
  function priced(t, h) {
    var sells = h.calcSells(t.sb, t.sellPremium, t.contracts);
    var buys = h.calcBuys(t.sb, t.sellPremium, t.contracts);
    var total = sells + buys;
    var out = Object.assign({}, t, { sells: sells, buys: buys, total: total });
    out.netPL = h.calcNetPL(total, out.closePremium, out.action || "Open");
    out.moneyOnHold = h.calcMOH(out);
    return out;
  }

  function cleanTrade(src) {
    var t = {
      account: str(src.account), date: day(src.date), company: str(src.company),
      ticker: str(src.ticker).toUpperCase(), strike: str(src.strike), currentStock: str(src.currentStock),
      expDate: day(src.expDate), sellPremium: str(src.sellPremium), contracts: str(src.contracts),
      cp: src.cp === "C" ? "C" : "P", sb: src.sb === "B" ? "B" : "S"
    };
    return t;
  }

  function missing(t) {
    var need = [];
    if (!t.account) need.push("account");
    if (!t.ticker) need.push("stock");
    if (num(t.strike) === null) need.push("strike");
    if (!t.expDate) need.push("expiry");
    if (num(t.sellPremium) === null) need.push("premium");
    if (!(parseInt(t.contracts, 10) > 0)) need.push("contracts");
    return need;
  }

  // Shares in or out when an option ends in assignment, as the Close dialog
  // does (prepareShareEffect), without asking: the phone already asked.
  function shareEffect(t, action, when, stocks, h, idBase, notes) {
    var qty = (parseInt(t.contracts, 10) || 1) * 100;
    if (action === "Assigned" && t.cp === "P") {
      stocks = stocks.concat([{
        id: idBase + 1, account: t.account, ticker: t.ticker,
        company: t.company || (h.tickerName ? h.tickerName(t.ticker) : "") || "",
        shares: String(qty), dateAcquired: when, costBasis: t.strike,
        currentPrice: t.currentStock || t.strike, status: "Assigned", soldDate: "", soldPrice: ""
      }]);
      notes.push("Added " + qty + " " + t.ticker + " shares to " + t.account + " (put assigned).");
      return stocks;
    }
    if (action === "Called Away" && t.cp === "C") {
      var px = num(t.strike) || 0, remaining = qty, adds = [], patch = {};
      var acct = str(t.account), tk = str(t.ticker).toUpperCase();
      stocks.filter(function (s) {
        return str(s.account) === acct && str(s.ticker).toUpperCase() === tk &&
               s.status !== "Sold" && (parseFloat(s.shares) || 0) > 0;
      }).sort(function (a, b) {
        return (a.dateAcquired || "9999-12-31").localeCompare(b.dateAcquired || "9999-12-31");
      }).forEach(function (lot, i) {
        if (remaining <= 0) return;
        var have = parseFloat(lot.shares) || 0, take = Math.min(have, remaining);
        remaining -= take;
        if (take >= have) {
          patch[lot.id] = Object.assign({}, lot, { status: "Sold", soldDate: when, soldPrice: px.toFixed(2) });
        } else {
          patch[lot.id] = Object.assign({}, lot, { shares: String(have - take) });
          adds.push(Object.assign({}, lot, { id: idBase + 2 + i, shares: String(take), status: "Sold",
                                             soldDate: when, soldPrice: px.toFixed(2) }));
        }
      });
      if (remaining > 0) {
        notes.push("⚠ " + tk + ": " + qty + " shares were called away but " + acct + " held only " +
                   (qty - remaining) + ". Check your holdings.");
      } else {
        notes.push("Sold " + qty + " " + tk + " shares in " + acct + " (call assigned).");
      }
      return stocks.map(function (s) { return patch[s.id] || s; }).concat(adds);
    }
    return stocks;
  }

  function applyPhoneOps(trades, stocks, ops, h, alreadyApplied) {
    var done = {};
    (alreadyApplied || []).forEach(function (id) { done[id] = true; });
    var res = { trades: trades.slice(), stocks: stocks.slice(), watchlist: Object.assign({}, h.watchlist || {}),
                applied: [], files: [], history: [], notes: [], lines: [],
                counts: { added: 0, closed: 0, fixed: 0, deleted: 0, watched: 0, skipped: 0 } };

    ops.forEach(function (op, n) {
      if (op.file) res.files.push(op.file);           // read: never try this file again
      if (!op.opId || done[op.opId]) return;
      done[op.opId] = true;
      res.applied.push(op.opId);
      var at = str(op.at);
      var idBase = (Date.parse(at) || 0) + n * 10;
      var find = function (id) {
        for (var i = 0; i < res.trades.length; i++) if (String(res.trades[i].id) === String(id)) return i;
        return -1;
      };
      var skip = function (why) { res.counts.skipped++; res.notes.push("Skipped a phone change: " + why); };

      if (op.op === "new") {
        var src = op.trade || {};
        if (src.id === undefined || find(src.id) >= 0) return;      // already here
        var t = cleanTrade(src);
        var need = missing(t);
        if (need.length) return skip("a new trade was missing its " + need.join(", ") + ".");
        if (!t.date) t.date = at.slice(0, 10);
        if (!t.company && h.tickerName) t.company = h.tickerName(t.ticker) || "";
        t = priced(Object.assign({ id: src.id }, t, { action: "Open", closeDate: "", closePremium: "",
                                                    fromPhone: true }), h);
        res.trades.push(t);
        res.counts.added++;
        res.lines.push("➕ New trade: " + label(t) + ", " + (t.sb === "B" ? "bought" : "sold") + ", " + contractsText(t) +
                       " at $" + t.sellPremium + " a share, expires " + shortDay(t.expDate) + " (" + dollars(t.total) + ")");
        return;
      }

      // Watchlist: {TICKER: "Company Name"}, the same shape the Screener keeps.
      if (op.op === "watch") {
        var tk = str(op.ticker).toUpperCase();
        if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(tk)) return skip("\"" + str(op.ticker) + "\" is not a stock symbol.");
        if (res.watchlist[tk] !== undefined) return;                 // already on it
        res.watchlist[tk] = str(op.name) || (h.tickerName ? h.tickerName(tk) : "") || "";
        res.counts.watched++;
        res.lines.push("👁 Added " + tk + (res.watchlist[tk] ? " (" + res.watchlist[tk] + ")" : "") + " to your watchlist");
        return;
      }

      var i = find(op.id);
      if (i < 0) return skip("the trade it changes is no longer in your records.");
      var cur = res.trades[i];

      if (op.op === "close") {
        var action = str(op.action);
        if (CLOSE_ACTIONS.indexOf(action) < 0) return skip(label(cur) + ": unknown way of closing.");
        if (!isOpen(cur)) return skip(label(cur) + " was already closed on the computer.");
        var when = day(op.closeDate) || at.slice(0, 10);
        var rollTrade = null;
        if (action === "Rolled" && op.roll) {
          var r = op.roll, qty = parseInt(r.contracts, 10) || 0;
          if (!day(r.expDate) || num(r.strike) === null || num(r.premium) === null || !qty)
            return skip(label(cur) + ": the roll was missing its new expiry, strike, premium or contracts.");
          if (day(r.expDate) <= when) return skip(label(cur) + ": the new expiry must be after the close date.");
          rollTrade = priced({
            id: r.id !== undefined ? r.id : idBase + 3, rolledFromId: cur.id,
            account: cur.account, ticker: cur.ticker, company: cur.company || "",
            cp: cur.cp, sb: cur.sb, date: when, strike: str(r.strike), expDate: day(r.expDate),
            sellPremium: str(r.premium), contracts: String(qty), currentStock: cur.currentStock || "",
            action: "Open", closeDate: "", closePremium: "", fromPhone: true
          }, h);
        }
        var cp = action === "Expired" || action === "Assigned" || action === "Called Away" ? "" : str(op.closePremium);
        var closed = Object.assign({}, cur, { action: action, closeDate: when, closePremium: cp,
                                              netPL: h.calcNetPL(cur.total, cp, action), moneyOnHold: 0 });
        if (rollTrade) closed.rolledToId = rollTrade.id;
        res.history.push({ opId: op.opId, at: at, before: cur, after: closed });
        res.trades[i] = closed;
        if (rollTrade && find(rollTrade.id) < 0) res.trades.push(rollTrade);
        res.stocks = shareEffect(cur, action, when, res.stocks, h, idBase, res.notes);
        res.counts.closed++;
        res.lines.push(rollTrade
          ? "🔁 Rolled " + label(cur) + " on " + shortDay(when) + " (buy-back " + dollars(cp) + ") into the $" + rollTrade.strike +
            " " + (rollTrade.cp === "C" ? "call" : "put") + " expiring " + shortDay(rollTrade.expDate) + ", " + contractsText(rollTrade) +
            " at $" + rollTrade.sellPremium + " a share"
          : "✅ Closed " + label(cur) + ": " + action + " on " + shortDay(when) + (cp !== "" ? " for " + dollars(cp) : "") +
            ". Net P&L " + dollars(closed.netPL));
        return;
      }

      if (op.op === "edit") {
        var changes = op.changes || {}, base = op.base || {}, upd = Object.assign({}, cur), clash = false;
        EDITABLE.forEach(function (k) {
          if (!(k in changes)) return;
          if (k in base && str(base[k]) !== str(cur[k])) clash = true;   // changed here meanwhile
          upd[k] = k === "ticker" ? str(changes[k]).toUpperCase()
                 : k === "cp" ? (changes[k] === "C" ? "C" : "P")
                 : k === "sb" ? (changes[k] === "B" ? "B" : "S")
                 : (k === "date" || k === "expDate" || k === "closeDate") ? day(changes[k]) : str(changes[k]);
        });
        if (isOpen(upd)) { upd.closeDate = ""; upd.closePremium = ""; }
        var need2 = missing(upd);
        if (need2.length) return skip(label(cur) + ": the fix left out the " + need2.join(", ") + ".");
        upd = priced(upd, h);
        res.history.push({ opId: op.opId, at: at, before: cur, after: upd });
        res.trades[i] = upd;
        res.counts.fixed++;
        res.lines.push("✏️ Fixed " + label(cur) + ": " + EDITABLE.filter(function (k) {
          return k in changes && str(cur[k]) !== str(upd[k]);
        }).map(function (k) { return FIELD_NAMES[k] + " " + shown(k, cur[k]) + " → " + shown(k, upd[k]); }).join(", "));
        if (clash) res.notes.push(label(cur) + " was also changed on the computer. The phone's fix, " +
                                  "made later, was kept.");
        return;
      }

      if (op.op === "delete") {
        if (!cur.fromPhone) return skip(label(cur) + " was logged on the computer, so it can only be deleted there.");
        res.history.push({ opId: op.opId, at: at, before: cur, after: null });
        res.trades.splice(i, 1);
        res.counts.deleted++;
        res.lines.push("🗑 Deleted " + label(cur) + ", expiring " + shortDay(cur.expDate));
        return;
      }
      skip("unknown kind of change.");
    });
    return res;
  }

  function summary(c) {
    var parts = [];
    if (c.added) parts.push(c.added + " new trade" + (c.added > 1 ? "s" : ""));
    if (c.closed) parts.push(c.closed + " close" + (c.closed > 1 ? "s" : ""));
    if (c.fixed) parts.push(c.fixed + " fix" + (c.fixed > 1 ? "es" : ""));
    if (c.deleted) parts.push(c.deleted + " delete" + (c.deleted > 1 ? "s" : ""));
    if (c.watched) parts.push(c.watched + " watchlist ticker" + (c.watched > 1 ? "s" : ""));
    return parts.length ? "📱 Added from your phone: " + parts.join(", ") + "." : "";
  }

  root.OptionIQPhone = { applyPhoneOps: applyPhoneOps, summary: summary };
  if (typeof module !== "undefined") module.exports = root.OptionIQPhone;
})(typeof window !== "undefined" ? window : globalThis);

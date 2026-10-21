// OptionIQ prices — a small Cloudflare Worker that gives the OptionIQ phone
// app live option prices from Yahoo Finance (the same source the computer uses).
// A phone web page can't ask Yahoo directly (Yahoo blocks it), so it asks here.
//
//   /                      "OptionIQ prices is running"
//   /test                  a few AAPL option prices, to check Yahoo answers
//   /quotes?c=AAPL|2026-10-23|215|P,KO|2026-11-06|67|P
//                          price of each contract: ticker|expiry|strike|C or P
//
// It keeps nothing: no trades, accounts or amounts, only the contracts asked
// about in each request. © Quantum Nexus LLC.

const ALLOWED_ORIGINS = ["https://skjaggi.github.io"];
const MAX_CONTRACTS = 120;
const MAX_CHAINS = 40;   // Cloudflare's free plan allows 50 outside requests per call
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

let session = null;   // Yahoo cookie + crumb, reused for an hour

async function yahooSession(force) {
  if (session && !force && Date.now() - session.at < 3600e3) return session;
  const r1 = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
  const raw = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [r1.headers.get("set-cookie") || ""];
  const cookie = raw.map(c => c.split(";")[0].trim()).filter(Boolean).join("; ");
  const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { "User-Agent": UA, Cookie: cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.length > 40 || crumb.includes("<")) throw new Error("Yahoo didn't let us in (" + r2.status + ")");
  session = { cookie, crumb, at: Date.now() };
  return session;
}

// One ticker + expiry date -> that day's calls and puts.
async function chain(ticker, expiry) {
  const date = expiry ? "&date=" + Date.UTC(+expiry.slice(0, 4), +expiry.slice(5, 7) - 1, +expiry.slice(8, 10)) / 1000 : "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await yahooSession(attempt > 0);
    const url = "https://query2.finance.yahoo.com/v7/finance/options/" + encodeURIComponent(ticker) +
                "?crumb=" + encodeURIComponent(s.crumb) + date;
    const r = await fetch(url, { headers: { "User-Agent": UA, Cookie: s.cookie } });
    if (r.status === 401 || r.status === 403) continue;   // stale cookie: sign in again once
    if (!r.ok) throw new Error("Yahoo answered " + r.status);
    const j = await r.json();
    const res = j && j.optionChain && j.optionChain.result && j.optionChain.result[0];
    const opt = res && res.options && res.options[0];
    if (!opt) throw new Error("no options for " + ticker + (expiry ? " on " + expiry : ""));
    return { calls: opt.calls || [], puts: opt.puts || [], expiry: opt.expirationDate };
  }
  throw new Error("Yahoo refused the request");
}

const num = v => (typeof v === "number" && isFinite(v) ? v : null);

function priceOf(o) {
  const bid = num(o.bid), ask = num(o.ask), last = num(o.lastPrice);
  const mid = bid > 0 && ask > 0 ? Math.round((bid + ask) / 2 * 100) / 100 : null;
  return { bid, ask, last, mid, price: mid != null ? mid : last, lastTrade: o.lastTradeDate || null };
}

async function quotes(list) {
  const groups = {};
  list.forEach(c => { (groups[c.ticker + "|" + c.expiry] = groups[c.ticker + "|" + c.expiry] || []).push(c); });
  const out = [], keys = Object.keys(groups);
  keys.slice(MAX_CHAINS).forEach(k => groups[k].forEach(c => out.push({ c: c.key, error: "too many at once, ask again" })));
  await Promise.all(keys.slice(0, MAX_CHAINS).map(async k => {
    const [ticker, expiry] = k.split("|");
    try {
      const ch = await chain(ticker, expiry);
      groups[k].forEach(c => {
        const side = c.cp === "C" ? ch.calls : ch.puts;
        const o = side.find(x => Math.abs(num(x.strike) - c.strike) < 0.001);
        out.push(o ? Object.assign({ c: c.key }, priceOf(o)) : { c: c.key, error: "strike not listed" });
      });
    } catch (e) {
      groups[k].forEach(c => out.push({ c: c.key, error: String(e.message || e) }));
    }
  }));
  return out;
}

function parse(param) {
  return String(param || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, MAX_CONTRACTS).map(key => {
    const [t, e, k, cp] = key.split("|");
    const ticker = String(t || "").toUpperCase(), strike = parseFloat(k), side = String(cp || "").toUpperCase();
    if (!/^[A-Z][A-Z.\-]{0,9}$/.test(ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(e || "") || !(strike > 0) || !/^[CP]$/.test(side)) return null;
    return { key, ticker, expiry: e, strike, cp: side };
  }).filter(Boolean);
}

function reply(body, status, origin) {
  const h = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin) { h["Access-Control-Allow-Origin"] = origin; h["Vary"] = "Origin"; }
  return new Response(JSON.stringify(body), { status: status || 200, headers: h });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    // Only the OptionIQ phone app's pages (or someone typing the address) may use it.
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ ok: false, error: "not allowed" }, 403);
    const allow = origin || null;
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": allow || "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" } });
    }
    try {
      if (url.pathname === "/quotes") {
        const list = parse(url.searchParams.get("c"));
        if (!list.length) return reply({ ok: false, error: "no contracts" }, 400, allow);
        return reply({ ok: true, at: new Date().toISOString(), results: await quotes(list) }, 200, allow);
      }
      if (url.pathname === "/test") {
        const ch = await chain("AAPL", "");
        const sample = ch.puts.slice(Math.floor(ch.puts.length / 2), Math.floor(ch.puts.length / 2) + 3)
          .map(o => Object.assign({ strike: o.strike }, priceOf(o)));
        return reply({ ok: true, message: "Yahoo answered. Live prices are working.", expiry: new Date(ch.expiry * 1000).toISOString().slice(0, 10), puts: sample }, 200, allow);
      }
      return new Response("OptionIQ prices is running. © Quantum Nexus LLC.", { headers: { "Content-Type": "text/plain" } });
    } catch (e) {
      return reply({ ok: false, error: String(e.message || e) }, 502, allow);
    }
  },
};

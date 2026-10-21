// Lets OptionIQ open with no signal, showing the last data it saw. The app's
// own files are kept; everything else (OneDrive, Finnhub) always goes online.
// Bump VERSION with every change to the app's files so phones pick it up.
var VERSION = "oiq-phone-1.0-14";
var FILES = ["./", "index.html", "app.css", "app.js", "storage.js", "phone_inbox.js", "sums.js", "terms.txt",
             "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // Only this app's old copies (a test copy on the same site keeps its own).
    return Promise.all(keys.filter(function (k) { return k.indexOf("oiq-phone-") === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// The app's files: newest from the internet when there is a signal, the saved
// copy when there isn't.
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // "no-cache" asks GitHub whether a file changed instead of using the
  // browser's 10-minute copy, so a fix reaches the phone on the next open.
  e.respondWith(fetch(url.href, { cache: "no-cache", credentials: "same-origin" }).then(function (r) {
    var copy = r.clone();
    caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true });
  }));
});

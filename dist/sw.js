const CACHE = "review-studio-v1";
const FILES = [
  "./",
  "index.html",
  "style.css",
  "engine.js",
  "app.js",
  "sample.svg",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("review-studio-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => response)
      .catch(() =>
        caches
          .match(event.request)
          .then((response) => response || Response.error()),
      ),
  );
});

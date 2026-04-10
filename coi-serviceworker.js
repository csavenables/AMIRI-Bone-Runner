/**
 * coi-serviceworker — enables Cross-Origin Isolation on GitHub Pages.
 * Injects COOP + COEP headers so SharedArrayBuffer (required for
 * multithreaded WebAssembly in the Miris splat renderer) is available.
 *
 * Uses COEP "credentialless" (not "require-corp") so CDN scripts such as
 * jsdelivr load without needing their own Cross-Origin-Resource-Policy header.
 */

if (typeof window === "undefined") {
  // ── Service-worker context ──────────────────────────────────────────────────
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

  self.addEventListener("fetch", e => {
    // Skip opaque no-cors cache-only requests (avoid fetch errors)
    if (e.request.cache === "only-if-cached" && e.request.mode !== "same-origin") return;

    e.respondWith(
      fetch(e.request).then(response => {
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        headers.set("Cross-Origin-Embedder-Policy", "credentialless");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
    );
  });

} else {
  // ── Page context — register the worker, reload once if not yet isolated ────
  (() => {
    if (window.crossOriginIsolated !== false) return; // already isolated
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register(document.currentScript.src)
      .then(() => {
        if (!window.crossOriginIsolated) {
          // Only reload once — if still not isolated after a reload the browser
          // doesn't support credentialless COEP (e.g. iOS Safari). Bail out so
          // we don't get an infinite reload loop. SDK falls back gracefully.
          if (!sessionStorage.getItem("coi-reloaded")) {
            sessionStorage.setItem("coi-reloaded", "1");
            window.location.reload();
          }
        }
      });
  })();
}

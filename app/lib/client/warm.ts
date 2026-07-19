// Warm the service-worker asset cache with every route chunk so screens the
// user hasn't visited yet (e.g. the expense form) still open offline. With
// routeDiscovery "initial" the full manifest is on window.
export function warmRouteChunks(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  const schedule =
    (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ??
    ((cb: () => void) => setTimeout(cb, 2000));
  schedule(() => {
    void navigator.serviceWorker.ready.then(() => {
      const manifest = (
        window as unknown as {
          __reactRouterManifest?: {
            entry?: ManifestEntry;
            routes?: Record<string, ManifestEntry | undefined>;
          };
        }
      ).__reactRouterManifest;
      if (!manifest) return;
      const urls = new Set<string>();
      const collect = (entry?: ManifestEntry) => {
        if (!entry) return;
        if (entry.module) urls.add(entry.module);
        for (const url of entry.imports ?? []) urls.add(url);
        for (const url of entry.css ?? []) urls.add(url);
      };
      collect(manifest.entry);
      for (const route of Object.values(manifest.routes ?? {})) collect(route);
      for (const url of urls) {
        void fetch(url, { credentials: "same-origin" }).catch(() => {});
      }
    });
  });
}

interface ManifestEntry {
  module?: string;
  imports?: string[];
  css?: string[];
}

// Apply saved theme synchronously before React mounts.
// Reads from localStorage (written by applyTheme() in lib/theme.ts) so the
// correct .dark class is on <html> before the first paint, ensuring Radix
// portal content (dropdown menus, tooltips) inherits the right CSS variables
// without any flash or race with the async IndexedDB read in useTheme().
//
// Loaded via a plain (non-module) <script src="/theme-init.js"> tag in
// index.html, placed before the module script. WXT's dev server rewrites
// truly-inline <script> bodies into a cross-origin virtual module, which
// violates the MV3 default CSP (script-src 'self'); a file loaded via `src`
// is unaffected. Non-module scripts execute immediately in document order,
// ahead of the deferred module script, so this still runs before React mounts.
//
// Lives in public/ (not entrypoints/popup/) so Vite copies it verbatim to
// the build output instead of trying to bundle it — a non-module <script src>
// pointing at a file under src/ is left as an unresolved literal reference
// by Vite's html plugin and never gets emitted, which 404s in production.
try {
  const t = localStorage.getItem("tabmerger-theme");
  if (t === "dark") {
    document.documentElement.classList.add("dark");
  } else if (t === "system" || t === null) {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.classList.add("dark");
    }
  }
  // t === 'light' → no class needed; :root defaults are light-mode values
} catch (e) {}

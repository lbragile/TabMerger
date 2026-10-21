/**
 * Which browser this bundle was built for. WXT builds each browser separately and injects
 * `import.meta.env.FIREFOX` as a build-time constant. Kept apart from `dataConsent.ts` (which
 * re-exports it) so UI that only needs the browser does not pull in, or depend on test mocks of,
 * the consent module.
 */
export function isFirefoxBuild(): boolean {
  // ponytail: `import.meta.env.FIREFOX` is a real boolean at build time (a WXT-injected Vite
  // `define`), but `vi.stubEnv()` in tests only ever assigns strings — `Boolean('false')` is
  // `true`, so a naive `Boolean(...)` here would treat a test's explicit "not Firefox" stub as
  // Firefox. Accept both the real boolean and vitest's stringified form.
  const flag = import.meta.env.FIREFOX as unknown;
  return flag === true || flag === 'true';
}

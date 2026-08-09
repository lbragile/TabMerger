// ponytail: canned fixtures matching each route's real response shape
// (see packages/web/app/api/ai/*/route.ts) — enough to exercise the UI, not
// realistic AI quality. Keyed by pathname so devFetchMock.ts can match on
// `new URL(url).pathname` regardless of origin. A fixture may be a plain
// object, or a function of the parsed request body for routes whose response
// needs to reference real request data (e.g. group-tabs must echo back real
// tab ids, or nothing in the extension will ever match them).
export const aiFixtures: Record<string, unknown | ((body: Record<string, unknown>) => unknown)> = {
  '/api/ai/group-tabs': (body: { tabs?: { id: number }[] }) => {
    const ids = (body.tabs ?? []).slice(0, 2).map((t) => t.id);
    return { groups: ids.length > 0 ? [{ name: 'Research', color: 'rgba(66,133,244,1)', tabIds: ids }] : [] };
  },
  '/api/ai/name-group': { name: 'Shopping' },
  '/api/ai/suggest-sessions': (body: { groups?: { id: string }[] }) => {
    const ids = (body.groups ?? []).slice(0, 3).map((g) => g.id);
    const message = `You have ${ids.length} groups untouched for 2 weeks — consider archiving them.`;
    return { message, staleGroupIds: ids, suggestion: message };
  },
  '/api/ai/organize': { runId: 'mock-run-id', token: 'mock-hook-token' },
  '/api/ai/tab-summary': { summary: 'A mock summary of this page for local dev.' },
};

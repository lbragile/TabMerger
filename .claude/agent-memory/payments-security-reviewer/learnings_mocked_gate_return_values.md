---
name: learnings-mocked-gate-return-values
description: When a route test mocks an entitlement or usage gate, check that each mocked return value is one the real function can produce, and look for a companion test that runs the real gate against a stubbed subscription row
metadata:
  type: reference
---

A method for reviewing route tests that mock an entitlement or usage gate (a function returning
something like `{ allowed, remaining }`).

- **List the values the real gate can return, then compare each mocked value with that list.** A
  mock can return a combination the real function never produces; the test then covers a branch
  of the route that no real request reaches, and the status code it asserts is not the one a
  real caller gets.
- **Proof that an unpaid account is rejected needs the real gate.** Look for a test that calls
  the route with the real function (`vi.importActual`) over a stubbed subscription row, for each
  of: free, paid-but-wrong-tier, canceled, no row. Assert that the model mock was not called and
  that the usage table was not written, not only the status code.
- **Check every route that shares the gate.** A `describe.each` over the simple routes can leave
  out a route with its own describe block (a workflow start, an approval step).
- **Compare the statuses the gate accepts with the shared entitled-status list**, and say which
  side is stricter: a stricter server is a drift between what is shown and what is served, a
  looser server is an enforcement gap.
- **When validation moves ahead of the gate**, look for a body that passes validation and is
  then turned into a different, valid request (a fallback path) instead of being rejected: it is
  charged like any other request.

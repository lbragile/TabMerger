# Design System Agent Memory

- [Accessibility patterns](learnings_accessibility_patterns.md) — span-vs-button semantics, dnd-kit handle aria-label, icon-only button labels, contrast ratio fix, accordion aria-controls, decorative SVG aria-hidden
- [A11y Audit 2026-07](a11y_audit_2026_07.md) — WCAG 2.1 AA fixes: interactive spans, aria-labels, keyboard nav, contrast
- Units: use `rem`, not `px`, for positioning/sizing/font sizes (rem follows the browser's text size); the full rule and its exceptions are in the agent definition's "Component conventions". The toast CSS in web `globals.css` was converted as the first case.
- [Signed-in header on phones](learnings_app_header_mobile.md) — app/(app)/layout.tsx header overflowed 390px phones (442px); icons-only below `sm` with aria-labels, 16px gutter, shrink rules; verify by measuring scrollWidth at 360/390/1280 with a throwaway LOCAL user
- [SessionCard 3-column overflow](learnings_session_card_overflow.md) — side-by-side flex-row panel overflowed lg:grid-cols-3; collapsible section below + `min-w-0` on the grid item and every truncating flex child

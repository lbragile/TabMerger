---
name: learnings-solid-primary-tokens
description: Extension solid primary fills use --primary-solid* tokens (not --primary) for 4.5:1 label contrast; hover is its own token; how to test and screenshot it
metadata:
  type: reference
---

- Light `--primary` (`193 100% 40%`) with white text is 3.05:1. Every solid fill with a text label (Button and Badge default variants, the view header's Restore) uses `bg-primary-solid text-primary-solid-foreground hover:bg-primary-solid-hover` (`--primary-solid` light `193 100% 28%` = 5.67:1; hover `193 100% 24%` = 7.11:1). `--primary` stays for tints (`bg-primary/10`), text links, rings, the switch.
- Dark theme must not change: the solid pair equals `--primary`/`--primary-foreground`, and the dark hover token is `193 80% 55% / 0.9` (an hsl alpha inside the token, which Tailwind's `hsl(var(--x))` registration accepts), identical to the old `bg-primary/90`.
- Old light hover `bg-primary/90` on white was 2.74:1: a see-through hover lightens toward white, so give hover its own darker token instead of an opacity.
- A new solid-primary component: use the Button default variant or the token trio. Grep `bg-primary\b` / `text-primary-foreground` to find stragglers. The `buttonVariants()` users (BuyCreditsLink) follow automatically.
- Contrast test: `src/__tests__/unit/styles/sessionViewContrast.test.ts` reads globals.css tokens, composites an alpha hover over the page background.
- E2E: axe `withRules(['color-contrast']).include('[role="dialog"]')` in `e2e/tests/a11y.spec.ts`; the Add Group modal opens only from a tab's Move to group > "Create new group..." menu (the sidebar "Add Group" button adds directly).
- Before/after screenshots without a second build: inject `:root{--primary-solid:193 100% 40%!important;...}` via `page.addStyleTag` for the "before".
- Visual-regression baselines change for light-theme screens with primary buttons.

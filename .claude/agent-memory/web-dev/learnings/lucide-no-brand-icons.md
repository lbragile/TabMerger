---
name: lucide-no-brand-icons
description: lucide-react in this repo's installed version has no Github/brand icons; inline the brand SVG instead
metadata:
  type: feedback
---

`lucide-react` dropped brand/logo icons (Github, Twitter, etc.) some versions ago. Importing
`Github` from `lucide-react` compiles fine (TypeScript doesn't catch it because the package's
types are broad) but fails at runtime in both the browser and Vitest/RTL with "Element type is
invalid: expected a string ... but got undefined" — a hard-to-diagnose error that doesn't name
the missing icon.

**Why:** discovered while adding GitHub Discussions links to `packages/web/app/(marketing)/beta/page.tsx`
— `import { Github } from 'lucide-react'` rendered fine in review but blew up every RTL test with
a generic "invalid element type" stack trace pointing at `createFiberFromElement`, not at the
import.

**How to apply:** before using any brand-adjacent lucide icon (Github, Twitter/X, Discord, etc.),
verify it exists first: `node -e "console.log(typeof require('lucide-react').Github)"` from
`packages/web`. If it's `undefined`, inline the official SVG mark as a tiny local component (see `GitHubMark`
in `app/(marketing)/beta/page.tsx`) — a fork glyph misreads as "fork this repo".

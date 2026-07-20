---
name: ts-strict-nextjs15
description: TypeScript strict mode and ESLint gotchas specific to Next.js 15 App Router
metadata:
  type: feedback
---

## TypeScript strict mode

`tsconfig.json` already had `"strict": true` from project init — nothing to add. `tsc --noEmit` was already clean.

## ESLint — `react-hooks/set-state-in-effect`

The project ESLint config treats calling `setState` synchronously inside `useEffect` as an **error** (not a warning). This fires on the common pattern of reading `localStorage` in an effect to initialize state:

```ts
// WRONG — triggers error
const [view, setView] = useState('grid')
useEffect(() => {
  const stored = localStorage.getItem(KEY)
  if (stored) setView(stored) // error here
}, [])
```

**Fix:** use the lazy `useState` initializer — runs once on mount, no extra render, no lint violation:

```ts
// CORRECT
const [view, setView] = useState<'grid' | 'list'>(() => {
  const stored = localStorage.getItem(KEY)
  return stored === 'list' ? 'list' : 'grid'
})
```

This also eliminates the unnecessary render cycle the effect version caused.

Remember to remove the `useEffect` import if it was only there for this pattern — unused imports are flagged by `@typescript-eslint/no-unused-vars`.

import { generateChangelogModule } from './scripts/generate-changelog.mjs'

/**
 * Runs once before the suite: writes `generated/changelog.ts` (the build-time copy of
 * CHANGELOG.md that lib/changelog.ts imports), as `next dev` / `next build` do through
 * next.config.ts, so tests run from a fresh checkout too.
 */
export default function setup(): void {
  generateChangelogModule()
}

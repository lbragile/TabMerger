import { generateChangelogModule } from './scripts/generate-changelog.mjs'
import { generateBlogIndexModule } from './scripts/generate-blog-index.mjs'

/**
 * Runs once before the suite: writes the build-time modules that `next dev` / `next build` write
 * through next.config.ts, so tests run from a fresh checkout too: `generated/changelog.ts` (the
 * copy of CHANGELOG.md that lib/changelog.ts imports) and `generated/blog.ts` (the blog's post
 * files, read by lib/blog/posts.ts).
 */
export default function setup(): void {
  generateChangelogModule()
  generateBlogIndexModule()
}

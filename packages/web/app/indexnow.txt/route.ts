import { INDEXNOW_KEY } from '@/lib/indexNow'

// Static: the key only changes with a deploy, like robots.txt and llms.txt beside it.
export const dynamic = 'force-static'

/**
 * The IndexNow key file: the key alone, as plain UTF-8 text, which is what search engines fetch to
 * check a submission came from this site. See `lib/indexNow.ts`.
 */
export function GET() {
  return new Response(INDEXNOW_KEY, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

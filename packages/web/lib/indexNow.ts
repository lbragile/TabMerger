/**
 * IndexNow (indexnow.org): a ping that tells Bing, Yandex, Seznam and Naver which URLs changed, so
 * they recrawl within hours instead of on their own schedule. Bing's index is what ChatGPT search
 * reads, so a fresh Bing crawl is how a new feature or price reaches AI answers.
 *
 * The key is public by design, not a secret: IndexNow proves a submitter controls the site by
 * fetching this key from the site itself (`INDEXNOW_KEY_PATH`). Anyone can read it there; it only
 * lets someone ask search engines to recrawl our own public pages, which costs us nothing.
 * To rotate it, change the value and deploy before the next submission.
 */
export const INDEXNOW_KEY = '8d52356bc0e253ad07ef1a2b738f0662'

/**
 * Where the key file is served (`app/indexnow.txt/route.ts`). At the site root, so the key covers
 * every URL on the host (IndexNow only accepts URLs at or below the key file's folder).
 * `scripts/indexnow-submit.mjs` reads the key from here on the live site.
 */
export const INDEXNOW_KEY_PATH = '/indexnow.txt'

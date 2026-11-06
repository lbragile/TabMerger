/**
 * Content type for JSON bodies POSTed to the web app without credentials (`/api/track`,
 * `/api/og-preview`).
 *
 * The extension has no host permissions, so every request to the web app is a cross-origin CORS
 * request. `application/json` is not a CORS-safelisted content type and forces an OPTIONS
 * preflight before every POST. `text/plain` is safelisted, so a POST with only this header and a
 * string body is a "simple request" and costs one round trip instead of two. The routes parse the
 * JSON body regardless of content type (older installs still send `application/json`).
 *
 * Adding any other header to these requests (e.g. `Authorization` or a custom header) brings the
 * preflight back.
 */
export const SIMPLE_JSON_CONTENT_TYPE = 'text/plain;charset=UTF-8';

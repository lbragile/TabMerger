/**
 * Starts a file by sending this tab to its address. For a response the browser cannot display
 * (a download, or a Firefox add-on, which Firefox offers to install) the page on screen stays
 * where it is. No new tab or window, so popup blockers are not involved.
 *
 * Kept on its own so tests can replace it: jsdom cannot navigate.
 */
export function startFile(href: string): void {
  window.location.assign(href)
}

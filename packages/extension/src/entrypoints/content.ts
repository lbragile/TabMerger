export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Expose page metadata for tab preview (title, og:description, etc.)
    const getMeta = () => {
      const ogDesc = document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute('content');
      const metaDesc = document
        .querySelector('meta[name="description"]')
        ?.getAttribute('content');

      return {
        title: document.title,
        description: ogDesc ?? metaDesc ?? null,
        url: location.href
      };
    };

    // Listen for metadata requests from the extension
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'GET_PAGE_META') {
        sendResponse(getMeta());
        return true;
      }
    });
  }
});

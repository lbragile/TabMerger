chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  window.postMessage(
    { type: "FROM_EXT", tabs: request.tabs },
    "http://localhost:3000"
  );
});

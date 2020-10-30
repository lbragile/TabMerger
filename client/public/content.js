chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  window.postMessage({ tabs: request.tabs }, "http://localhost:3000");
});

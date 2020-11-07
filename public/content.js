chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  window.postMessage({ tabs: request.tabs }, "https://tabmerger.netlify.app");
});

var url =
  "%NODE_ENV%" === "production"
    ? "https://tabmerger.netlify.app"
    : "http://localhost:3000";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  window.postMessage({ tabs: request.tabs }, url);
});

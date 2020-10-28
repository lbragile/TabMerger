chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  var ul = document.getElementById("tab-urls");
  var tabs_to_remove = [];
  [...request.tabs].forEach((tab) => {
    if (!tab.url.includes("localhost:3000")) {
      let a = document.createElement("a");
      a.href = tab.url;
      a.innerHTML = tab.url;
      a.target = "_blank";

      let li = document.createElement("li");
      li.append(a);

      ul.append(li);

      tabs_to_remove.push(tab.id);
    }
  });
  sendResponse({ remove_tabs: tabs_to_remove });
});

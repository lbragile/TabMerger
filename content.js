chrome.tabs.getAllInWindow(null, (tabs) => {
  var ul = document.getElementById("tab-urls");
  [...tabs].forEach((tab) => {
    if (!tab.url.includes("chrome-extension://")) {
      let a = document.createElement("a");
      a.href = tab.url;
      a.innerHTML = tab.url;
      a.target = "_blank";

      let li = document.createElement("li");
      li.append(a);

      ul.append(li);

      chrome.tabs.remove(tab.id);
    }
  });
  //   document.getElementById(
  //     "tab-urls"
  //   ).style.listStyleImage = `url('${tab.favIconUrl}')`;
});

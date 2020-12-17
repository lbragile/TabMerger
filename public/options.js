function setTabMergerLink() {
  var link;
  var isOpera = navigator.userAgent.indexOf(" OPR/") >= 0;
  var isFirefox = typeof InstallTrigger !== "undefined";
  var isIE = /*@cc_on!@*/ false || !!document.documentMode;
  var isEdge = !isIE && !!window.StyleMedia;
  var isChrome = !!window.chrome && !!window.chrome.runtime;
  var isEdgeChromium = isChrome && navigator.userAgent.indexOf("Edg") !== -1;

  if (isIE || isEdge || isEdgeChromium) {
    link =
      "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";
  } else if (isFirefox) {
    link = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
  } else if (isChrome || isOpera) {
    link =
      "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
  }

  document.getElementById("logo-img").parentNode.href = link;
}

const restoreOptions = () => {
  setTabMergerLink();

  var body = document.querySelector("body");
  var hr = document.querySelector("hr");
  var code_block = document.querySelector("code");

  chrome.storage.sync.get("settings", (result) => {
    var settings = result.settings;
    document.getElementById("options-default-color").value = settings.color;
    document.getElementById("options-default-title").value = settings.title;
    document.querySelectorAll("input[name='restore-tabs']").forEach((x) => {
      x.checked = x.value === settings.restore;
    });
    document.querySelectorAll("input[name='ext-open']").forEach((x) => {
      x.checked = x.value === settings.open;
    });
    document.getElementById("options-blacklist").value = settings.blacklist;

    // dark mode adjustments
    body.style.background = settings.dark ? "rgb(52, 58, 64)" : "white";
    body.style.color = settings.dark ? "white" : "black";
    hr.style.borderTop = settings.dark
      ? "1px white solid"
      : "1px rgba(0,0,0,.1) solid";
    code_block.style.color = settings.dark ? "white" : "black";
    code_block.style.border = settings.dark
      ? "1px white solid"
      : "1px black solid";

    var darkMode = document.getElementById("darkMode");
    darkMode.checked = settings.dark;
    darkMode.addEventListener("change", () => window.location.reload());
  });
};

const saveOptions = (e) => {
  e.target.classList.replace("btn-primary", "btn-success");
  document.getElementById("save-text").classList.remove("invisible");
  setTimeout(() => {
    e.target.classList.replace("btn-success", "btn-primary");
    document.getElementById("save-text").classList.add("invisible");
    window.location.reload();
  }, 500);
};

const resetOptions = () => {
  window.location.reload();
};

const goHome = () => {
  window.location.replace("/index.html");
};

const setSync = () => {
  if (document.activeElement.id === "reset-btn") {
    var default_settings = {
      open: "without",
      color: "#dedede",
      title: "Title",
      restore: "keep",
      blacklist: "",
      dark: true,
    };

    chrome.storage.sync.set({ settings: default_settings });
  } else {
    var color = document.getElementById("options-default-color").value;
    var title = document.getElementById("options-default-title").value;
    var restore = document.querySelector("input[name='restore-tabs']:checked")
      .value;
    var open = document.querySelector("input[name='ext-open']:checked").value;
    var blacklist = document.getElementById("options-blacklist").value;
    var dark = document.getElementById("darkMode").checked;

    chrome.storage.sync.get("settings", (result) => {
      var store_val = { open, color, title, restore, blacklist, dark };
      if (store_val !== result.settings) {
        chrome.storage.sync.set({ settings: store_val });
      }
    });
  }
};

window.addEventListener("load", restoreOptions);
window.addEventListener("beforeunload", setSync);

document.getElementById("save-btn").addEventListener("click", saveOptions);
document.getElementById("reset-btn").addEventListener("click", resetOptions);
document.getElementById("home-btn").addEventListener("click", goHome);

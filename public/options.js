function saveOptions(e) {
  var color = document.getElementById("options-default-color").value;
  var title = document.getElementById("options-default-title").value;
  var restore = document.querySelector("input[name='restore-tabs']:checked")
    .value;
  var open = document.querySelector("input[name='ext-open']:checked").value;
  var blacklist = document.getElementById("options-blacklist").value;

  chrome.storage.sync.get("settings", (result) => {
    var dark = result.settings.dark;

    chrome.storage.sync.set({
      settings: { open, color, title, restore, blacklist, dark },
    });
  });

  e.target.classList.replace("btn-primary", "btn-success");
  document.getElementById("save-text").classList.remove("invisible");
  setTimeout(() => {
    e.target.classList.replace("btn-success", "btn-primary");
    document.getElementById("save-text").classList.add("invisible");
  }, 1500);
}

function restoreOptions() {
  var body = document.querySelector("body");
  var hr = document.querySelector("hr");
  var code_block = document.querySelector("code");

  chrome.storage.sync.get("settings", (result) => {
    var settings = result.settings;
    document.getElementById("options-default-color").value = settings.color;
    document.getElementById("options-default-title").value = settings.title;
    document.querySelectorAll("input[name='restore-tabs']").forEach((item) => {
      item.checked = item.value === settings.restore;
    });
    document.querySelectorAll("input[name='ext-open']").forEach((item) => {
      item.checked = item.value === settings.open;
    });
    document.getElementById("options-blacklist").value = settings.blacklist;

    // dark mode adjustments
    body.style.background = settings.dark ? "#06090F" : "white";
    body.style.color = settings.dark ? "white" : "black";
    hr.style.borderTop = settings.dark
      ? "1px white solid"
      : "1px rgba(0,0,0,.1) solid";
    code_block.style.color = settings.dark ? "white" : "black";
    code_block.style.border = settings.dark
      ? "1px white solid"
      : "1px black solid";
  });
}

function goHome() {
  var homeURL = window.location.href.replace("options", "index");
  window.location.replace(homeURL);
}

window.addEventListener("load", restoreOptions);
document.getElementById("save-btn").addEventListener("click", saveOptions);
document.getElementById("home-btn").addEventListener("click", goHome);

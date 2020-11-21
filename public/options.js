function saveOptions(e) {
  var color = document.getElementById("options-default-color").value;
  var title = document.getElementById("options-default-title").value;
  var restore = document.querySelector("input[name='restore-tabs']:checked")
    .value;
  var blacklist = document.getElementById("options-blacklist").value;

  window.localStorage.setItem(
    "settings",
    JSON.stringify({ color, title, restore, blacklist })
  );

  e.target.classList.replace("btn-primary", "btn-success");
  document.getElementById("save-text").classList.remove("invisible");
  setTimeout(() => {
    e.target.classList.replace("btn-success", "btn-primary");
    document.getElementById("save-text").classList.add("invisible");
  }, 1500);
}

function restoreOptions() {
  var settings = JSON.parse(window.localStorage.getItem("settings"));

  if (settings) {
    document.getElementById("options-default-color").value = settings.color;
    document.getElementById("options-default-title").value = settings.title;
    document.querySelectorAll("input[name='restore-tabs']").forEach((item) => {
      item.checked = item.value === settings.restore;
    });
    document.getElementById("options-blacklist").value = settings.blacklist;
  }
}

function goHome() {
  var homeURL = window.location.href.replace("options", "index");
  window.location.replace(homeURL);
}

window.addEventListener("load", restoreOptions);
document.getElementById("save-btn").addEventListener("click", saveOptions);
document.getElementById("home-btn").addEventListener("click", goHome);

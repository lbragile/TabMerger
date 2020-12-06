function saveOptions(e) {
  var color = document.getElementById("options-default-color").value;
  var title = document.getElementById("options-default-title").value;
  var restore = document.querySelector("input[name='restore-tabs']:checked")
    .value;
  var open = document.querySelector("input[name='ext-open']:checked").value;
  var blacklist = document.getElementById("options-blacklist").value;

  window.localStorage.setItem(
    "settings",
    JSON.stringify({ open, color, title, restore, blacklist })
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
  var body = document.querySelector("body");
  var hr = document.querySelector("hr");
  var code_block = document.querySelector("code");

  if (settings && settings.dark) {
    body.style.background = "#343a40";
    body.style.color = "white";
    hr.style.borderTop = "1px white solid";
    code_block.style.color = "white";
    code_block.style.border = "white 1px solid";
  } else {
    body.style.background = "white";
    body.style.color = "black";
    hr.style.borderTop = "1px rgba(0,0,0,.1) solid";
    code_block.style.color = "black";
    code_block.style.border = "black 1px solid";
  }

  if (settings) {
    document.getElementById("options-default-color").value = settings.color;
    document.getElementById("options-default-title").value = settings.title;
    document.querySelectorAll("input[name='restore-tabs']").forEach((item) => {
      item.checked = item.value === settings.restore;
    });
    document.querySelectorAll("input[name='ext-open']").forEach((item) => {
      item.checked = item.value === settings.open;
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

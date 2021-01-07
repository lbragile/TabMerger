/*
TabMerger as the name implies merges your tabs into one location to save
memory usage and increase your productivity.

Copyright (C) 2021  Lior Bragilevsky

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

If you have any questions, comments, or concerns you can contact the
TabMerger team at <https://lbragile.github.io/TabMerger-Extension/contact/>
*/

function setTabMergerLink() {
  var link;
  var isOpera = navigator.userAgent.indexOf(' OPR/') >= 0;
  var isFirefox = typeof InstallTrigger !== 'undefined';
  var isIE = /*@cc_on!@*/ false || !!document.documentMode;
  var isEdge = !isIE && !!window.StyleMedia;
  var isChrome = !!window.chrome && !!window.chrome.runtime;
  var isEdgeChromium = isChrome && navigator.userAgent.indexOf('Edg') !== -1;

  if (isIE || isEdge || isEdgeChromium) {
    link = 'https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn';
  } else if (isFirefox) {
    link = 'https://addons.mozilla.org/en-CA/firefox/addon/tabmerger';
  } else if (isChrome || isOpera) {
    link = 'https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc';
  }

  document.getElementById('logo-img').parentNode.href = link;
}

const restoreOptions = () => {
  setTabMergerLink();

  var body = document.querySelector('body');
  var hr = document.querySelector('hr');
  var code_block = document.querySelector('code');

  chrome.storage.sync.get('settings', (result) => {
    var settings = result.settings;
    document.getElementById('options-default-color').value = settings.color;
    document.getElementById('options-default-title').value = settings.title;
    document.querySelectorAll("input[name='restore-tabs']").forEach((x) => {
      x.checked = x.value === settings.restore;
    });
    document.querySelectorAll("input[name='ext-open']").forEach((x) => {
      x.checked = x.value === settings.open;
    });
    document.getElementById('options-blacklist').value = settings.blacklist;

    // dark mode adjustments
    body.style.background = settings.dark ? 'rgb(52, 58, 64)' : 'white';
    body.style.color = settings.dark ? 'white' : 'black';
    hr.style.borderTop = settings.dark ? '1px white solid' : '1px rgba(0,0,0,.1) solid';
    code_block.style.color = settings.dark ? 'white' : 'black';
    code_block.style.border = settings.dark ? '1px white solid' : '1px black solid';

    var darkMode = document.getElementById('darkMode');
    darkMode.checked = settings.dark;
    darkMode.addEventListener('change', () => {
      setSync();
      window.location.reload();
    });
  });
};

const saveOptions = (e) => {
  e.target.classList.replace('btn-primary', 'btn-success');
  e.target.innerText = 'Saved';
  e.target.disabled = true;

  setSync();

  setTimeout(() => {
    e.target.classList.replace('btn-success', 'btn-primary');
    e.target.innerText = 'Save';
    e.target.disabled = false;
  }, 1500);
};

const resetOptions = () => {
  var default_settings = {
    blacklist: '',
    color: '#dedede',
    dark: true,
    open: 'without',
    restore: 'keep',
    title: 'Title',
  };

  chrome.storage.sync.get('settings', (sync) => {
    if (JSON.stringify(sync.settings) !== JSON.stringify(default_settings)) {
      chrome.storage.sync.set({ settings: default_settings }, () => {
        window.location.reload();
      });
    }
  });
};

const goHome = () => {
  window.location.replace('/index.html');
};

const setSync = () => {
  var color = document.getElementById('options-default-color').value;
  var title = document.getElementById('options-default-title').value;
  var restore = document.querySelector("input[name='restore-tabs']:checked").value;
  var open = document.querySelector("input[name='ext-open']:checked").value;
  var blacklist = document.getElementById('options-blacklist').value;
  var dark = document.getElementById('darkMode').checked;

  var store_val = { open, color, title, restore, blacklist, dark };
  chrome.storage.sync.set({ settings: store_val });
};

window.addEventListener('load', restoreOptions);
document.getElementById('save-btn').addEventListener('click', saveOptions);
document.getElementById('reset-btn').addEventListener('click', resetOptions);
document.getElementById('home-btn').addEventListener('click', goHome);

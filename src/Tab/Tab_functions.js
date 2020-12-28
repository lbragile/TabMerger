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
TabMerger team at <https://tabmerger.herokuapp.com/contact/>
*/

export function setInitTabs(setTabs, id) {
  chrome.storage.local.get("groups", (local) => {
    var groups = local.groups;
    setTabs((groups && groups[id] && groups[id].tabs) || []);
  });
}

export function dragStart(e) {
  var target = e.target.tagName === "DIV" ? e.target : e.target.parentNode;
  target.classList.add("dragging");
  target.closest(".group").classList.add("drag-origin");
}

export function dragEnd(e, item_limit, setGroups) {
  e.stopPropagation();
  e.target.classList.remove("dragging");

  const tab = e.target;
  var closest_group = e.target.closest(".group");

  var drag_origin = document.getElementsByClassName("drag-origin")[0];
  drag_origin.classList.remove("drag-origin");

  const origin_id = drag_origin.id;

  var anchor = tab.querySelector("a");
  var tab_bytes = JSON.stringify({
    title: anchor.innerText,
    url: anchor.href,
  }).length;

  chrome.storage.local.get("groups", (local) => {
    var result = local.groups;
    var itemBytesInUse = JSON.stringify(result[closest_group.id]).length;

    // moving into same group should not increase number of bytes
    var newBytesInUse =
      origin_id !== closest_group.id
        ? itemBytesInUse + tab_bytes
        : itemBytesInUse;

    if (newBytesInUse < item_limit) {
      if (origin_id !== closest_group.id) {
        // remove tab from group that originated the drag
        result[origin_id].tabs = result[origin_id].tabs.filter((group_tab) => {
          return group_tab.url !== tab.lastChild.href;
        });
      }

      // reorder tabs based on current positions
      result[closest_group.id].tabs = [
        ...closest_group.lastChild.querySelectorAll("div"),
      ].map((x) => ({
        title: x.lastChild.textContent,
        url: x.lastChild.href,
      }));

      // update the groups
      chrome.storage.local.set({ groups: result }, () => {
        setGroups(JSON.stringify(result));
      });
    } else {
      alert(`Group's syncing capacity exceeded by ${
        newBytesInUse - item_limit
      } bytes.\n\nPlease do one of the following:
          1. Create a new group and merge new tabs into it;
          2. Remove some tabs from this group;
          3. Merge less tabs into this group (each tab is ~100-300 bytes).`);
      window.location.reload();
    }
  });
}

export function removeTab(e, tabs, setTabs, setTabTotal, setGroups) {
  var tab = e.target.closest(".draggable");
  var url = tab.querySelector("a").href;
  var group = tab.closest(".group");

  chrome.storage.local.get("groups", (local) => {
    var group_blocks = local.groups;
    group_blocks[group.id].tabs = tabs.filter((x) => x.url !== url);
    chrome.storage.local.set({ groups: group_blocks }, () => {
      setTabs(group_blocks[group.id].tabs);
      setTabTotal(document.querySelectorAll(".draggable").length);
      setGroups(JSON.stringify(group_blocks));
    });
  });
}

export function handleTabClick(e) {
  // ["tab", url_link]
  e.preventDefault();
  var tab = e.target.tagName === "SPAN" ? e.target.parentNode : e.target;
  chrome.storage.local.set({ remove: ["tab", tab.href] });
}

export function getFavIconURL(url) {
  var matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
  var domain = matches && matches[1]; // domain will be null if no match is found
  return "http://www.google.com/s2/favicons?domain=" + domain;
}

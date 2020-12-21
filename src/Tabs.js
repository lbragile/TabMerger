import React, { useState, useRef, useEffect } from "react";

import "./Tabs.css";

import { TiDelete } from "react-icons/ti";
import { AiOutlineMenu } from "react-icons/ai";

export default function Tabs(props) {
  const TAB_TITLE_LENGTH = useRef(80);

  const [tabs, setTabs] = useState([]);

  useEffect(() => {
    chrome.storage.local.get("groups", (local) => {
      var groups = local.groups;
      setTabs((groups && groups[props.id] && groups[props.id].tabs) || []);
    });
  }, [props.id]);

  const dragStart = (e) => {
    var target = e.target.tagName === "DIV" ? e.target : e.target.parentNode;
    target.classList.add("dragging");
    target.closest(".group").classList.add("drag-origin");
  };

  const dragEnd = (e) => {
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

      if (newBytesInUse < props.itemLimit) {
        if (origin_id !== closest_group.id) {
          // remove tab from group that originated the drag
          result[origin_id].tabs = result[origin_id].tabs.filter(
            (group_tab) => {
              return group_tab.url !== tab.lastChild.href;
            }
          );
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
          props.setGroups(JSON.stringify(result));
        });
      } else {
        alert(`Group's syncing capacity exceeded by ${
          newBytesInUse - props.itemLimit
        } bytes.\n\nPlease do one of the following:
          1. Create a new group and merge new tabs into it;
          2. Remove some tabs from this group;
          3. Merge less tabs into this group (each tab is ~100-300 bytes).`);
        window.location.reload();
      }
    });
  };

  function removeTab(e) {
    var tab = e.target.closest(".draggable");
    var url = tab.querySelector("a").href;
    var group = tab.closest(".group");

    chrome.storage.local.get("groups", (local) => {
      var group_blocks = local.groups;
      group_blocks[group.id].tabs = tabs.filter((x) => x.url !== url);
      chrome.storage.local.set({ groups: group_blocks }, () => {
        setTabs(group_blocks[group.id].tabs);
        props.setTabTotal(document.querySelectorAll(".draggable").length);
        props.setGroups(JSON.stringify(group_blocks));
      });
    });
  }

  function handleTabClick(e) {
    // ["tab", url_link]
    e.preventDefault();
    var tab = e.target.tagName === "SPAN" ? e.target.parentNode : e.target;
    chrome.storage.local.set({ remove: ["tab", tab.href] });
  }

  function getFavIconURL(url) {
    var matches = url.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
    var domain = matches && matches[1]; // domain will be null if no match is found
    return "http://www.google.com/s2/favicons?domain=" + domain;
  }

  return (
    <div className="d-flex flex-column mx-0 tabs-container">
      {tabs.map((tab) => {
        return (
          <div
            className="row draggable p-0 mx-0 "
            draggable
            onDragStart={dragStart}
            onDragEnd={dragEnd}
            key={Math.random()}
          >
            <p
              className="close-tab mr-2"
              draggable={false}
              onClick={(e) => removeTab(e)}
            >
              <TiDelete size="1.2rem" color="black" />
            </p>
            <p className="move-tab mr-2">
              <AiOutlineMenu size="1.2rem" color="black" />
            </p>
            <img
              className="img-tab mr-2"
              src={getFavIconURL(tab.url) || "./images/logo16.png"}
              alt="icon"
              draggable={false}
            />
            <a
              href={tab.url}
              className="a-tab"
              target="_blank"
              rel="noreferrer"
              draggable={false}
              onClick={(e) => handleTabClick(e)}
            >
              <span className="float-left">
                {tab.title.length > TAB_TITLE_LENGTH.current
                  ? tab.title.substring(0, TAB_TITLE_LENGTH.current) + "..."
                  : tab.title}
              </span>
            </a>
          </div>
        );
      })}
    </div>
  );
}

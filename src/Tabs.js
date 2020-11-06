import React, { useState, useEffect } from "react";

import "./Tabs.css";
export default function Tabs(props) {
  const [tabs, setTabs] = useState(() => {
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    return (groups && groups[props.id] && groups[props.id].tabs) || [];
  });

  useEffect(() => {
    function triggerEvent(e) {
      /* istanbul ignore next */
      if (
        (e.origin.includes("tests/integration") && e.source !== window) ||
        props.id !== "group-0"
      )
        return;

      // want to only use unique tabs, if multiple identical tabs are open we only store the unique ones
      var tabs_arr = tabs;
      var combined_arr = [...tabs_arr, ...e.data.tabs];
      var unique_arr = Array.from(
        new Set(
          combined_arr.map((item) =>
            JSON.stringify({
              url: item.url,
              favIconUrl: item.favIconUrl,
              title: item.title,
            })
          )
        )
      );
      unique_arr = unique_arr.map((item) => JSON.parse(item));
      tabs_arr = unique_arr.filter(
        (item) =>
          item.url &&
          item.url.includes("http") &&
          !item.url.includes("localhost")
      );

      setTabs(tabs_arr);
      updateGroups(tabs_arr);
    }

    // total tab count
    var group_blocks = JSON.parse(window.localStorage.getItem("groups"));
    var current_tab_total = group_blocks
      ? Object.values(group_blocks).reduce((total, item) => {
          return total + item.tabs.length;
        }, 0)
      : 0;

    window.localStorage.setItem("tabTotal", current_tab_total);
    props.setTabTotal(current_tab_total);

    window.addEventListener("message", (e) => triggerEvent(e));

    /* istanbul ignore next */
    return () => {
      window.removeEventListener("message", (e) => triggerEvent(e));
    };
  });

  function updateGroups(arr) {
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    groups[props.id].tabs = arr;
    window.localStorage.setItem("groups", JSON.stringify(groups));
  }

  function removeTab(e) {
    var url = e.target.parentNode.querySelector("a").href;
    e.target.parentNode.style.display = "none";
    var tabs_arr = tabs;
    tabs_arr = tabs_arr.filter((item) => item.url !== url);
    setTabs(tabs_arr);
    updateGroups(tabs_arr);

    var current = window.localStorage.getItem("tabTotal");
    window.localStorage.setItem("tabTotal", current - 1);
    props.setTabTotal(current - 1);
  }

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

    // update localStorage
    var group_blocks = JSON.parse(window.localStorage.getItem("groups"));

    if (origin_id !== closest_group.id) {
      // remove tab from group that originated the drag
      group_blocks[origin_id].tabs = group_blocks[origin_id].tabs.filter(
        (group_tab) => {
          return group_tab.url !== tab.lastChild.href;
        }
      );
    }

    // reorder tabs based on current positions
    group_blocks[closest_group.id].tabs = [
      ...closest_group.lastChild.querySelectorAll("div"),
    ].map((item) => {
      return {
        title: item.lastChild.textContent,
        url: item.lastChild.href,
        favIconUrl: item.querySelectorAll("img")[0].src,
      };
    });

    window.localStorage.setItem("groups", JSON.stringify(group_blocks));

    // re-render page
    window.location.reload();
  };

  return (
    <div className="d-flex flex-column mx-4 my-2">
      <h5 className="tabTotal-inGroup mb-3">
        {tabs.length} {tabs.length === 1 ? "tab" : "tabs"} in this group
      </h5>
      {tabs.map((tab, index) => {
        return (
          <div
            className="row mb-1 draggable"
            id={props.id + "-tab-" + index}
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
              ✖
            </p>
            <p className="move-tab mr-2">☰</p>
            <img
              className="img-tab mr-2"
              src={tab.favIconUrl}
              width="24"
              height="24"
              alt="icon for the url"
              draggable={false}
            />
            <a
              href={tab.url}
              className="a-tab"
              target="_blank"
              rel="noreferrer"
              draggable={false}
            >
              {tab.title.length > 50
                ? tab.title.substring(0, 50) + "..."
                : tab.title}
            </a>
          </div>
        );
      })}
    </div>
  );
}

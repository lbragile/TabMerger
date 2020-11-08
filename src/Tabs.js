import React, { useState, useEffect, useRef, useCallback } from "react";

import "./Tabs.css";
export default function Tabs(props) {
  const tab_title_length = useRef(100);
  var [tabTotal, setTabTotal] = useState(
    parseInt(window.localStorage.getItem("tabTotal"))
  );
  const [tabs, setTabs] = useState(() => {
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    return (groups && groups[props.id] && groups[props.id].tabs) || [];
  });

  const setCurrentTabTotal = useCallback(() => {
    // total tab count
    var group_blocks = JSON.parse(window.localStorage.getItem("groups"));
    var current_tab_total = group_blocks
      ? Object.values(group_blocks).reduce((total, item) => {
          return total + item.tabs.length;
        }, 0)
      : 0;

    window.localStorage.setItem("tabTotal", current_tab_total);
    props.setTabTotal(current_tab_total);
    setTabTotal(current_tab_total);
  }, [props]);

  const triggerEvent = useCallback(() => {
    setTimeout(() => {
      var merged_tabs = JSON.parse(window.localStorage.getItem("merged_tabs"));
      window.localStorage.removeItem("merged_tabs");

      /* istanbul ignore next */
      if (props.id !== "group-0") {
        setCurrentTabTotal();
        return;
      }

      // want to only use unique tabs, if multiple identical tabs are open we only store the unique ones
      var tabs_arr = tabs;
      var combined_arr = [...tabs_arr, ...merged_tabs];
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
          !item.url.includes("chrome-extension") &&
          !item.url.includes("chrome://extensions") &&
          item.title !== "New Tab"
      );

      setTabs(tabs_arr);
      var groups = JSON.parse(window.localStorage.getItem("groups"));
      groups[props.id].tabs = tabs_arr;
      window.localStorage.setItem("groups", JSON.stringify(groups));
    }, 10);
  }, [props.id, setCurrentTabTotal, tabs]);

  useEffect(() => {
    setCurrentTabTotal();

    if ("merged_tabs" in window.localStorage) {
      triggerEvent();
    }

    const merge_btn = document.querySelector("#merge-btn");
    merge_btn.addEventListener("click", triggerEvent);

    return () => {
      merge_btn.removeEventListener("click", triggerEvent);
    };
  }, [setCurrentTabTotal, triggerEvent]);

  function removeTab(e) {
    var url = e.target.parentNode.querySelector("a").href;
    e.target.parentNode.style.display = "none";
    var tabs_arr = tabs;
    tabs_arr = tabs_arr.filter((item) => item.url !== url);
    setTabs(tabs_arr);

    //update groups
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    groups[props.id].tabs = tabs_arr;
    window.localStorage.setItem("groups", JSON.stringify(groups));

    var current = window.localStorage.getItem("tabTotal");
    window.localStorage.setItem("tabTotal", current - 1);
    props.setTabTotal(current - 1);

    window.location.reload();
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
        {tabs.length} {tabs.length === 1 ? "tab" : "tabs"} in group{" "}
        {!tabTotal ? null : `(${((tabs.length * 100) / tabTotal).toFixed(2)}%)`}
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
              {tab.title.length > tab_title_length.current
                ? tab.title.substring(0, tab_title_length.current) + "..."
                : tab.title}
            </a>
          </div>
        );
      })}
    </div>
  );
}

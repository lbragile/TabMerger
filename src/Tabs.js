import React, { useState, useEffect, useRef, useCallback } from "react";

import "./Tabs.css";

import { TiDelete } from "react-icons/ti";
import { AiOutlineMenu } from "react-icons/ai";

export default function Tabs(props) {
  const tab_title_length = useRef(100);
  const [tabs, setTabs] = useState(() => {
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    return (groups && groups[props.id] && groups[props.id].tabs) || [];
  });

  const mergeEvent = useCallback(() => {
    // skip groups which merging doesn't apply to
    if (props.id === window.localStorage.getItem("into_group")) {
      var merged_tabs = JSON.parse(window.localStorage.getItem("merged_tabs"));

      // remove local storage items that are no longer needed
      window.localStorage.removeItem("merged_tabs");
      window.localStorage.removeItem("into_group");

      // store relevant details of combined tabs
      var groups = JSON.parse(window.localStorage.getItem("groups"));
      var tabs_arr = [...groups[props.id].tabs, ...merged_tabs];
      tabs_arr = tabs_arr.map((item) => ({
        url: item.url,
        favIconUrl: item.favIconUrl,
        title: item.title,
      }));

      setTabs(tabs_arr);
      groups[props.id].tabs = tabs_arr;
      window.localStorage.setItem("groups", JSON.stringify(groups));
    }
  }, [props.id]);

  useEffect(() => {
    const checkMerging = (e) => {
      if (e.key === "merged_tabs") {
        // prettier-ignore
        var merged_tabs = JSON.parse(window.localStorage.getItem("merged_tabs"));
        var current_tabs = document.querySelectorAll(".draggable");
        props.setTabTotal(current_tabs.length + merged_tabs.length);
        mergeEvent();
      }
    };

    window.addEventListener("storage", checkMerging);

    return () => {
      window.removeEventListener("storage", checkMerging);
    };
  }, [mergeEvent, props]);

  function removeTab(e) {
    var url = e.target.closest("div").querySelector("a").href;
    var tabs_arr = tabs;
    tabs_arr = tabs_arr.filter((item) => item.url !== url);
    setTabs(tabs_arr);

    //update groups
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    groups[props.id].tabs = tabs_arr;
    window.localStorage.setItem("groups", JSON.stringify(groups));

    props.setTabTotal(document.querySelectorAll(".draggable").length - 1);
  }

  function keepOrRemoveTab(e) {
    // prettier-ignore
    var restore_val = JSON.parse(window.localStorage.getItem("settings")).restore;
    if (restore_val !== "keep") {
      removeTab(e);
    }
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
    window.location.reload();
  };

  function translate(msg) {
    return chrome.i18n.getMessage(msg);
  }

  return (
    <div className="d-flex flex-column mx-0">
      <h5 className="tabTotal-inGroup my-2">
        {tabs.length}{" "}
        {tabs.length === 1
          ? translate("groupTotalSingular")
          : translate("groupTotalPlural")}
      </h5>
      {tabs.map((tab, index) => {
        return (
          <div
            className="row draggable p-0 m-0"
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
              <TiDelete size="1.2rem" color="rgba(255,0,0,0.8)" />
            </p>
            <p className="move-tab mr-2">
              <AiOutlineMenu size="1.2rem" color="grey" />
            </p>
            <img
              className="img-tab mr-2"
              src={tab.favIconUrl || "./images/logo16.png"}
              width="24"
              height="24"
              alt="icon"
              draggable={false}
            />
            <a
              href={tab.url}
              className="a-tab"
              target="_blank"
              rel="noreferrer"
              draggable={false}
              onClick={(e) => keepOrRemoveTab(e)}
            >
              <span className="float-left">
                {tab.title.length > tab_title_length.current
                  ? tab.title.substring(0, tab_title_length.current) + "..."
                  : tab.title}
              </span>
            </a>
          </div>
        );
      })}
    </div>
  );
}

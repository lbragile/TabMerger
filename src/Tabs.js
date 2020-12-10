import React, { useState, useEffect, useRef } from "react";

import "./Tabs.css";

import { TiDelete } from "react-icons/ti";
import { AiOutlineMenu } from "react-icons/ai";

export default function Tabs(props) {
  const TAB_TITLE_LENGTH = useRef(100);
  const ITEM_STORAGE_LIMIT = useRef(7500);

  const [tabs, setTabs] = useState([]);

  useEffect(() => {
    chrome.storage.sync.get("groups", (result) => {
      setTabs(result.groups[props.id] ? result.groups[props.id].tabs : []);
    });
  }, []);

  useEffect(() => {
    const checkMerging = (changes, namespace) => {
      if (
        namespace === "local" &&
        changes.merged_tabs &&
        changes.merged_tabs.newValue &&
        changes.merged_tabs.newValue.length !== 0
      ) {
        console.log(changes.merged_tabs.newValue);
        chrome.storage.local.get(["merged_tabs", "into_group"], (local) => {
          chrome.storage.sync.getBytesInUse("groups", (bytesInUse) => {
            // prettier-ignore
            var into_group = local.into_group, merged_tabs = local.merged_tabs;
            var num_bytes = bytesInUse + merged_tabs.length;

            console.log(num_bytes);
            if (num_bytes < ITEM_STORAGE_LIMIT.current) {
              // close tabs to avoid leaving some open
              chrome.tabs.remove(merged_tabs.map((x) => x.id));

              // store relevant details of combined tabs (only if group matches id)
              if (props.id === into_group) {
                chrome.storage.sync.get("groups", (sync) => {
                  var tabs_arr = [
                    ...sync.groups[into_group].tabs,
                    ...merged_tabs,
                  ];
                  tabs_arr = tabs_arr.map((item) => ({
                    url: item.url,
                    favIconUrl: item.favIconUrl,
                    title: item.title,
                  }));

                  setTabs(tabs_arr);
                  var total = document.querySelectorAll(".draggable").length;
                  props.setTabTotal(total);

                  sync.groups[into_group].tabs = tabs_arr;
                  chrome.storage.sync.set({ groups: sync.groups }, () => {});
                });
              }
            } else {
              alert(
                `Syncing capacity exceeded by ${
                  num_bytes - ITEM_STORAGE_LIMIT.current
                } bytes.\n\nPlease do one of the following:
    1. Create a new group and merge new tabs into it;
    2. Remove some tabs from this group;
    3. Merge less tabs into this group (each tab is ~100-300 bytes).`
              );
            }

            chrome.storage.local.remove(["into_group", "merged_tabs"]);
          });
        });
      }
    };

    chrome.storage.onChanged.addListener(checkMerging);

    return () => {
      chrome.storage.onChanged.removeListener(checkMerging);
    };
  }, []);

  function removeTab(e) {
    var url = e.target.closest("div").querySelector("a").href;
    var tabs_arr = tabs.filter((item) => item.url !== url);
    setTabs(tabs_arr);
    props.setTabTotal(tabs_arr.length);

    //update groups
    chrome.storage.sync.get("groups", (result) => {
      result.groups[props.id].tabs = tabs_arr;
      chrome.storage.sync.set({ groups: result.groups }, () => {});
    });
  }

  async function keepOrRemoveTab(e) {
    e.preventDefault(); // stop from opening new tab
    // try to not open tabs if it is already open
    await new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true }, (windowTabs) => {
        var tab_url = e.target.href;
        var same_tab = windowTabs.filter((x) => x.url === tab_url);
        if (same_tab[0]) {
          chrome.tabs.update(
            same_tab[0].id,
            {
              highlighted: true,
              active: true,
            },
            (tab) => {
              chrome.tabs.move(tab.id, { index: -1 });
            }
          );
        } else {
          chrome.tabs.create({ url: tab_url, active: true });
        }
        resolve(0);
      });
    });

    chrome.storage.sync.get("settings", (result) => {
      if (result.settings.restore !== "keep") {
        removeTab(e);
      }
    });
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
    chrome.storage.sync.get("groups", (result) => {
      if (origin_id !== closest_group.id) {
        // remove tab from group that originated the drag
        result.groups[origin_id].tabs = result.groups[origin_id].tabs.filter(
          (group_tab) => {
            return group_tab.url !== tab.lastChild.href;
          }
        );
      }

      // reorder tabs based on current positions
      result.groups[closest_group.id].tabs = [
        ...closest_group.lastChild.querySelectorAll("div"),
      ].map((item) => {
        return {
          title: item.lastChild.textContent,
          url: item.lastChild.href,
          favIconUrl: item.querySelectorAll("img")[0].src,
        };
      });

      chrome.storage.sync.set({ groups: result.groups });
      window.location.reload();
    });
  };

  function translate(msg) {
    return chrome.i18n.getMessage(msg);
  }

  return (
    <div className="d-flex flex-column mx-0">
      <h5 className="tabTotal-inGroup mt-1 mb-3">
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

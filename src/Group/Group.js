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

import React, { useEffect, useState, useRef, useCallback } from "react";

// prettier-ignore
import { AiOutlineMinus,AiOutlineClose, AiOutlineReload } from "react-icons/ai";
import { VscChromeRestore } from "react-icons/vsc";
import { BiColorFill, BiArrowToRight } from "react-icons/bi";
import { MdVerticalAlignCenter } from "react-icons/md";

import Button from "../Button/Button.js";

import "./Group.css";
import "../Button/Button.css";

export default function Group(props) {
  const TITLE_TRIM_LIMIT = useRef(15);
  const [hide, setHide] = useState(false);

  const setGroupBackground = useCallback(
    (e) => {
      var color, target;
      if (e.target) {
        color = e.target.value;
        target = e.target.closest(".group-title");
      } else {
        var group_title = e.previousSibling;
        color = group_title.querySelector("input[type='color']").value;
        target = e;
      }
      [...target.parentNode.children].forEach((child) => {
        child.style.background = color;
      });

      chrome.storage.local.get("groups", (local) => {
        var current_groups = local.groups;
        if (current_groups && current_groups[props.id]) {
          current_groups[props.id].color = color;
          chrome.storage.local.set({ groups: current_groups });
        }
      });
    },
    [props.id]
  );

  useEffect(() => {
    var group = document.getElementById(props.id);
    setGroupBackground(group);
  }, [props.id, setGroupBackground]);

  function setTitle(e) {
    chrome.storage.local.get("groups", (local) => {
      var group_title = e.target.closest(".group-title");
      var group_id = group_title.nextSibling.id;
      var current_groups = local.groups;

      current_groups[group_id].title = e.target.firstChild.innerText;
      e.target.lastChild.style.visibility = "hidden";

      chrome.storage.local.set({ groups: current_groups }, () => {
        props.setGroups(JSON.stringify(current_groups));
      });
    });
  }

  function selectTitle(e) {
    var range = document.createRange();
    range.selectNodeContents(e.target.firstChild);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    e.target.lastChild.style.visibility = "visible";
  }

  function monitorTitleLength(e) {
    var text_len = e.target.firstChild.innerText.length;
    var isBackspace = e.keyCode === 8;
    var isEnter = e.keyCode === 13;
    var textSel =
      window.getSelection().focusOffset !== window.getSelection().anchorOffset;
    if (
      (!isBackspace && !textSel && text_len === TITLE_TRIM_LIMIT.current) ||
      (isBackspace && (text_len === 1 || textSel))
    ) {
      e.preventDefault();
    }

    if (isEnter) {
      e.target.blur();
    }
  }

  function reloadTitle(e) {
    var title_text = e.target.closest("p");
    title_text.firstChild.innerText = props.title;
    title_text.blur();
  }

  const dragOver = (e) => {
    e.preventDefault();
    var group_block = e.target.closest(".group");
    const afterElement = getDragAfterElement(group_block, e.clientY);
    const currentElement = document.querySelector(".dragging");
    var location = group_block.querySelector(".tabs-container");
    if (afterElement == null) {
      location.appendChild(currentElement);
    } else {
      location.insertBefore(currentElement, afterElement);
    }

    // allow scrolling while dragging
    window.scrollTop += e.clientY - e.pageY;
  };

  function getDragAfterElement(container, y) {
    const draggableElements = [
      ...container.querySelectorAll(".draggable:not(.dragging)"),
    ];

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  }

  function openGroup(e) {
    // ["group", ... url_links ...]
    var target = e.target.closest(".group-title").nextSibling;
    var tab_links = [...target.querySelectorAll(".a-tab")].map((x) => x.href);
    tab_links.unshift("group");
    chrome.storage.local.set({ remove: tab_links });
  }

  function deleteGroup(e) {
    chrome.storage.local.get("groups", (local) => {
      chrome.storage.sync.get("settings", (sync) => {
        var target = e.target.closest(".group-title").nextSibling;
        var group_blocks = local.groups;

        // if removed the only existing group
        if (Object.keys(group_blocks).length === 1) {
          group_blocks["group-0"] = {
            color: sync.settings.color,
            created: props.getTimestamp(),
            tabs: [],
            title: sync.settings.title,
          };
        } else {
          // must rename all keys for the groups above deleted group item
          var group_names = []; // need to change these
          var index_deleted = target.id.split("-")[1];
          Object.keys(group_blocks).forEach((key) => {
            if (parseInt(key.split("-")[1]) > parseInt(index_deleted)) {
              group_names.push(key);
            }
          });

          // perform the renaming of items
          var group_blocks_str = JSON.stringify(group_blocks);
          group_names.forEach((key) => {
            var new_name = "group-" + (parseInt(key.split("-")[1]) - 1);
            group_blocks_str = group_blocks_str.replace(key, new_name);
          });

          // get back json object with new item key names
          group_blocks = JSON.parse(group_blocks_str);

          // if group to be deleted is last - must only delete it
          if (!group_names[0]) {
            delete group_blocks["group-" + index_deleted];
          }
        }

        chrome.storage.local.set({ groups: group_blocks }, () => {
          // update total count
          props.setTabTotal(
            document.querySelectorAll(".draggable").length -
              target.querySelectorAll(".draggable").length
          );

          props.setGroups(JSON.stringify(group_blocks));
        });
      });
    });
  }

  function toggleGroup(e) {
    var tabs = e.target
      .closest(".group-title")
      .nextSibling.querySelectorAll(".draggable");
    tabs.forEach((tab) => {
      if (!hide) {
        tab.style.display = "none";
      } else {
        tab.style.removeProperty("display");
      }
    });

    setHide(!hide);
  }

  function sendMessage(msg) {
    chrome.runtime.sendMessage(chrome.runtime.id, msg);
  }

  function translate(msg) {
    try {
      return chrome.i18n.getMessage(msg);
    } catch (err) {
      return msg;
    }
  }

  return (
    <div className={"group-item " + ("group-0" === props.id ? "mt-0" : "mt-3")}>
      <div className="group-title d-flex flex-row justify-content-center">
        <h5 className="tabTotal-inGroup">
          {props.num_tabs + (props.num_tabs !== 1 ? " Tabs" : " Tab")}
        </h5>

        <p
          className="title-edit-input font-weight-bold p-1 mb-0"
          contentEditable
          onFocus={(e) => selectTitle(e)}
          onBlur={(e) => setTitle(e)}
          onKeyDown={(e) => monitorTitleLength(e)}
        >
          <span>{props.title}</span>
          <span className="reload-title">
            <AiOutlineReload size="1.2rem" onClick={(e) => reloadTitle(e)} />
          </span>
        </p>

        <div className="title-btn-containter row">
          <div>
            <div className="tip p-0">
              <BiColorFill
                className="input-color"
                onClick={(e) => e.target.closest("div").nextSibling.click()}
              />
              <span className="tiptext-group-color">
                {translate("pickColor")}
              </span>
            </div>
            <input
              type="color"
              defaultValue={props.color}
              onChange={(e) => setGroupBackground(e)}
            />
          </div>

          <Button
            classes="show-hide-btn btn-in-group-title"
            translate={hide ? translate("showTabs") : translate("hideTabs")}
            tooltip={"tiptext-group-title"}
            onClick={(e) => toggleGroup(e)}
          >
            <AiOutlineMinus />
          </Button>
          <Button
            classes="open-group-btn btn-in-group-title"
            translate={translate("openGroup")}
            tooltip={"tiptext-group-title"}
            onClick={(e) => openGroup(e)}
          >
            <VscChromeRestore />
          </Button>

          <Button
            classes="delete-group-btn btn-in-group-title"
            translate={translate("deleteGroup")}
            tooltip={"tiptext-group-title"}
            onClick={(e) => deleteGroup(e)}
          >
            <AiOutlineClose />
          </Button>
        </div>
      </div>

      <div id={props.id} className={props.className} onDragOver={dragOver}>
        <div className="created mr-1">
          <b>{translate("created")}:</b> <span>{props.created}</span>
        </div>
        <div className="merging-container float-right">
          <div className="d-flex flex-column">
            <Button
              classes="merge-btn btn-for-merging btn-outline-dark"
              translate={translate("mergeALLtabs")}
              tooltip={"tiptext-group-merge"}
              onClick={() => sendMessage({ msg: "all", id: props.id })}
            >
              <MdVerticalAlignCenter color="black" size="1.3rem" />
            </Button>
            <Button
              classes="merge-left-btn btn-for-merging btn-outline-dark"
              translate={translate("mergeLEFTtabs")}
              tooltip={"tiptext-group-merge"}
              onClick={() => sendMessage({ msg: "left", id: props.id })}
            >
              <BiArrowToRight color="black" size="1.3rem" />
            </Button>
            <Button
              classes="merge-right-btn btn-for-merging btn-outline-dark"
              translate={translate("mergeRIGHTtabs")}
              tooltip={"tiptext-group-merge"}
              onClick={() => sendMessage({ msg: "right", id: props.id })}
            >
              <BiArrowToRight color="black" size="1.3rem" />
            </Button>
          </div>
        </div>

        {props.children}
      </div>
    </div>
  );
}

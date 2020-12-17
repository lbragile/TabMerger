import React, { useEffect, useState, useRef } from "react";

import { IoMdCloseCircle, IoIosColorFill } from "react-icons/io";
import { FaWindowRestore } from "react-icons/fa";
import { BiArrowToRight } from "react-icons/bi";
import { MdVerticalAlignCenter } from "react-icons/md";
import { AiOutlineMinus, AiOutlineReload } from "react-icons/ai";

import Button from "./Button.js";
import "./Button.css";
import "./Group.css";

export default function Group(props) {
  const TITLE_TRIM_LIMIT = useRef(15);
  const [hide, setHide] = useState(false);

  useEffect(() => {
    var group = document.getElementById(props.id);
    setGroupBackground(group);
  }, [props.id]);

  function setGroupBackground(e) {
    var group_title = e.previousSibling;
    var color, target;
    if (e.target) {
      color = e.target.value;
      target = e.target.closest(".group-title");
    } else {
      color = group_title.querySelector("input[type='color']").value;
      target = e;
    }
    [...target.parentNode.children].forEach((child) => {
      child.style.background = color;
    });
  }

  function updateGroup(e, type) {
    var group_title = e.target.closest(".group-title");
    var group_id = group_title.nextSibling.id;
    var current_groups = JSON.parse(props.groups);
    if (type === "color") {
      current_groups[group_id].color = e.target.value;
    } else {
      current_groups[group_id].title = e.target.innerText;
      props.setTitle(e.target.innerText);
      e.target.lastChild.style.visibility = "hidden";
    }
    props.setGroups(JSON.stringify(current_groups));
  }

  function selectTitle(e) {
    var range = document.createRange();
    range.selectNodeContents(e.target);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    e.target.lastChild.style.visibility = "visible";
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
    if (afterElement == null) {
      group_block.lastChild.appendChild(currentElement);
    } else {
      group_block.lastChild.insertBefore(currentElement, afterElement);
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
    var target = e.target.closest(".group");
    var tab_links = [...target.querySelectorAll(".a-tab")].map((x) => x.href);
    tab_links.unshift("group");
    chrome.storage.local.set({ remove: tab_links });
  }

  function deleteGroup(e) {
    var target = e.target.closest(".group");

    // must rename all keys for the groups above deleted group item
    // (pass null to get all items - including settings)
    chrome.storage.sync.remove(target.id, () => {
      chrome.storage.sync.get(null, (result) => {
        // if removed the only existing group -> settings is left
        if (Object.keys(result).length === 1) {
          result["group-0"] = {
            title: result.settings.title,
            color: result.settings.color,
            created: new Date(Date.now()).toString(),
            tabs: [],
          };
        } else {
          var group_names = []; // need to change these
          var index_deleted = target.id.charAt(target.id.length - 1);
          Object.keys(result).forEach((key) => {
            if (
              key !== "settings" &&
              parseInt(key.charAt(key.length - 1)) > parseInt(index_deleted)
            ) {
              group_names.push(key);
            }
          });

          // perform the renaming of items
          var result_str = JSON.stringify(result);

          group_names.forEach((key) => {
            var new_index = parseInt(key.charAt(key.length - 1)) - 1;
            result_str = result_str.replace(key, "group-" + new_index);
          });

          // get back json object with new item key names
          result = JSON.parse(result_str);
        }

        // update total count
        props.setTabTotal(
          document.querySelectorAll(".draggable").length -
            target.querySelectorAll(".draggable").length
        );

        delete result.settings;
        props.setGroups(JSON.stringify(result));
      });
    });
  }

  function toggleGroup(e) {
    var tabs = e.target.closest(".group").querySelectorAll(".draggable");
    tabs.forEach((tab) => {
      if (!hide) {
        tab.style.display = "none";
      } else {
        tab.style.removeProperty("display");
      }
    });

    setHide(!hide);
  }

  function formatDate(date_str) {
    var date_parts = date_str.split(" ");
    date_parts = date_parts.filter((_, i) => 0 < i && i <= 4);

    // dd/mm/yyyy @ hh:mm:ss
    date_parts[0] = date_parts[1] + "/";
    date_parts[1] = new Date().getMonth() + 1 + "/";
    date_parts[2] += " @ ";

    return date_parts.join("");
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

  function monitorTitleLength(e) {
    if (e.target.innerText.length > TITLE_TRIM_LIMIT.current) {
      e.preventDefault();
    }

    if (e.keyCode === 13) {
      e.target.blur();
    }
  }

  return (
    <div className={props.id === "group-0" ? "mt-0" : "mt-3"}>
      <div className="created float-right mr-1">
        <b>{translate("created")}:</b>{" "}
        <span>
          {props.created.split(" ").length > 6
            ? formatDate(props.created)
            : props.created}
        </span>
      </div>

      <div className="group-title d-flex flex-row justify-content-center">
        <h5 className="tabTotal-inGroup">
          {JSON.parse(props.groups)[props.id].tabs.length + " Tabs"}
        </h5>

        <p
          className="title-edit-input font-weight-bold p-1 mb-0"
          contentEditable
          onFocus={(e) => selectTitle(e)}
          onBlur={(e) => updateGroup(e, "title")}
          onKeyDown={(e) => monitorTitleLength(e)}
        >
          <span>{props.title}</span>
          <span className="reload-title">
            <AiOutlineReload size="1.2rem" onClick={(e) => reloadTitle(e)} />
          </span>
        </p>

        <div className="title-btn-containter row">
          <div className="tip p-0">
            <span>
              <IoIosColorFill
                className="input-color"
                onClick={(e) => e.target.closest("span").nextSibling.click()}
              />
            </span>
            <input
              defaultValue={props.color}
              onChange={(e) => setGroupBackground(e)}
              onBlur={(e) => updateGroup(e, "color")}
              type="color"
            />
            <span className="tiptext-global">{translate("pickColor")}</span>
          </div>
          <Button
            classes="show-hide-btn btn-in-group-title"
            translate={hide ? translate("showTabs") : translate("hideTabs")}
            tooltip={"tiptext-group"}
            onClick={(e) => toggleGroup(e)}
          >
            <AiOutlineMinus color="darkcyan" />
          </Button>
          <Button
            classes="open-group-btn btn-in-group-title"
            translate={translate("openGroup")}
            tooltip={"tiptext-group"}
            onClick={(e) => openGroup(e)}
          >
            <FaWindowRestore color="forestgreen" />
          </Button>

          <Button
            classes="delete-group-btn btn-in-group-title"
            translate={translate("deleteGroup")}
            tooltip={"tiptext-group"}
            onClick={(e) => deleteGroup(e)}
          >
            <IoMdCloseCircle color="red" />
          </Button>
        </div>
      </div>

      <div id={props.id} className={props.className} onDragOver={dragOver}>
        <div className="merging-container float-right">
          <div className="d-flex flex-column">
            <Button
              classes="merge-btn btn-for-merging btn-outline-primary"
              translate={translate("mergeALLtabs")}
              tooltip={"tiptext-group"}
              onClick={() => sendMessage({ msg: "all", id: props.id })}
            >
              <MdVerticalAlignCenter color="black" size="1.3rem" />
            </Button>
            <Button
              classes="merge-left-btn btn-for-merging btn-outline-warning"
              translate={translate("mergeLEFTtabs")}
              tooltip={"tiptext-group"}
              onClick={() => sendMessage({ msg: "left", id: props.id })}
            >
              <BiArrowToRight color="black" size="1.3rem" />
            </Button>
            <Button
              classes="merge-right-btn btn-for-merging btn-outline-warning"
              translate={translate("mergeRIGHTtabs")}
              tooltip={"tiptext-group"}
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

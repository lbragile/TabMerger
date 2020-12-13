import React, { useEffect, useRef, useState } from "react";
import EdiText from "react-editext";

import { FcCollapse } from "react-icons/fc";
import { CgRemove } from "react-icons/cg";
import { FaWindowRestore } from "react-icons/fa";
import { BiArrowToRight } from "react-icons/bi";
import { BsPencilSquare } from "react-icons/bs";
import { MdVerticalAlignCenter } from "react-icons/md";

import Button from "./Button.js";
import "./Button.css";

import "./Group.css";
export default function Group(props) {
  const [title, setTitle] = useState(props.title);
  const [hide, setHide] = useState(false);

  const colorRef = useRef();

  useEffect(() => {
    setGroupBackground(colorRef.current);
  }, []);

  function setGroupBackground(target) {
    var children = target.closest(".group-title").parentNode.children;
    [...children].forEach((child) => {
      child.style.background = target.value;
    });
  }

  function updateGroupItem(name, value) {
    var storage_entry = {};
    storage_entry[name] = value;
    chrome.storage.sync.set(storage_entry, () => {});
  }

  function handleTitleChange(val) {
    chrome.storage.sync.get(null, (result) => {
      if (val.length < 15) {
        result[props.id].title = val;
      } else {
        alert("Titles must be less than 15 characters long!");
        result[props.id].title = title;
      }

      updateGroupItem(props.id, result[props.id]);
      setTitle(result[props.id].title);

      if (val.length >= 15) {
        // update the groups
        delete result.settings;
        props.setGroups(JSON.stringify(result));
      }
    });
  }

  function handleColorChange(e) {
    setGroupBackground(e.target);

    chrome.storage.sync.get(props.id, (result) => {
      result[props.id].color = e.target.value;
      updateGroupItem(props.id, result[props.id]);
    });
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

        // easiest to clear all the items and restore the values as needed
        chrome.storage.sync.clear(() => {
          Object.keys(result).forEach((key) => {
            updateGroupItem(key, result[key]);
          });

          delete result.settings;
          props.setGroups(JSON.stringify(result));
        });
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
    return chrome.i18n.getMessage(msg);
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
        <EdiText
          className="font-weight-bold"
          type="text"
          value={translate(title) || title}
          editButtonContent={
            <div className="tip p-0 mb-1">
              <BsPencilSquare color="saddlebrown" />
              <span className="tiptext-global">{translate("editTitle")}</span>
            </div>
          }
          onSave={(val) => {
            handleTitleChange(val);
          }}
        />
        <div className="tip ml-3 p-0">
          <input
            ref={colorRef}
            defaultValue={props.color}
            onChange={(e) => handleColorChange(e)}
            type="color"
          />
          <span className="tiptext-global">{translate("pickColor")}</span>
        </div>
      </div>

      <div id={props.id} className={props.className} onDragOver={dragOver}>
        <div className="mr-1 mt-1 row float-right">
          <Button
            classes="merge-btn mr-1 btn-in-group btn-outline-primary"
            translate={translate("mergeALLtabs")}
            tooltip={"tiptext-group"}
            onClick={() => sendMessage({ msg: "all", id: props.id })}
          >
            <MdVerticalAlignCenter color="black" size="1.3rem" />
          </Button>
          <Button
            classes="merge-left-btn mr-1 btn-in-group btn-outline-warning"
            translate={translate("mergeLEFTtabs")}
            tooltip={"tiptext-group"}
            onClick={() => sendMessage({ msg: "left", id: props.id })}
          >
            <BiArrowToRight color="black" size="1.3rem" />
          </Button>
          <Button
            classes="merge-right-btn mr-1 btn-in-group btn-outline-warning"
            translate={translate("mergeRIGHTtabs")}
            tooltip={"tiptext-group"}
            onClick={() => sendMessage({ msg: "right", id: props.id })}
          >
            <BiArrowToRight color="black" size="1.3rem" />
          </Button>

          <Button
            classes="open-group-btn mr-1 ml-2 btn-in-group btn-light btn-outline-success"
            translate={translate("openGroup")}
            tooltip={"tiptext-group"}
            onClick={(e) => openGroup(e)}
          >
            <FaWindowRestore color="forestgreen" />
          </Button>

          <Button
            classes="delete-group-btn mr-1 btn-in-group btn-light btn-outline-danger"
            translate={translate("deleteGroup")}
            tooltip={"tiptext-group"}
            onClick={(e) => deleteGroup(e)}
          >
            <CgRemove color="red" />
          </Button>

          <Button
            classes="show-hide-btn mr-1 ml-2 btn-in-group btn-light btn-outline-info"
            translate={hide ? translate("showTabs") : translate("hideTabs")}
            tooltip={"tiptext-group"}
            onClick={(e) => toggleGroup(e)}
          >
            <FcCollapse
              style={{ transform: hide ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </Button>
        </div>

        {props.children}
      </div>
    </div>
  );
}

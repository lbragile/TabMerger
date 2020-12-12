import React, { useEffect, useRef, useState } from "react";
import EdiText from "react-editext";

import { FcCollapse } from "react-icons/fc";
import { CgRemove } from "react-icons/cg";
import { FaWindowRestore } from "react-icons/fa";
import { BiArrowToRight } from "react-icons/bi";
import { BsPencilSquare } from "react-icons/bs";
import { MdVerticalAlignCenter } from "react-icons/md";

import "./Group.css";
export default function Group(props) {
  const [title, setTitle] = useState(props.title);
  const [hide, setHide] = useState(false);

  function backgroundColor(target) {
    var children = target.closest(".group-title").parentNode.children;
    [...children].forEach((child) => {
      child.style.background = target.value;
    });
  }

  const colorRef = useRef();
  useEffect(() => {
    backgroundColor(colorRef.current);
  }, []);

  function updateGroupItem(name, value) {
    var storage_entry = {};
    storage_entry[name] = value;
    chrome.storage.sync.set(storage_entry, () => {});
  }

  function handleTitleChange(val) {
    chrome.storage.sync.get(props.id, (result) => {
      if (val.length < 15) {
        result[props.id].title = val;
      } else {
        alert("Titles must be less than 15 characters long!");
        result[props.id].title = title;
      }

      updateGroupItem(props.id, result[props.id]);
      setTitle(result[props.id].title);

      if (val.length >= 15) {
        window.location.reload();
      }
    });
  }

  function handleColorChange(e) {
    backgroundColor(e.target);

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

  function openAllTabsInGroup(e) {
    var target = e.target.closest(".group");
    var tab_links = [...target.querySelectorAll(".a-tab")].map((x) => x.href);
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

        // easiest to clear all the items and restore the values as needed
        chrome.storage.sync.clear(() => {
          Object.keys(result).forEach((key) => {
            updateGroupItem(key, result[key]);
          });

          window.location.reload();
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
    // prettier-ignore
    const months = ["jan", "feb", "mar", "apr", "may", "jun",
                    "jul", "aug", "sep", "oct", "nov", "dec"];

    date_parts = date_parts.filter((items, index) => 0 < index && index <= 4);

    var temp = months.indexOf(date_parts[0].toLowerCase()) + 1 + "/";
    date_parts[0] = date_parts[1] + "/";
    date_parts[1] = temp;
    date_parts[2] = date_parts[2] + " @ ";

    return date_parts.join("");
  }

  function sendMessage(msg) {
    var extension_id = chrome.runtime.id;
    chrome.runtime.sendMessage(extension_id, msg);
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
              <span className="tiptext-bottom">{translate("editTitle")}</span>
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
          <span className="tiptext-bottom">{translate("pickColor")}</span>
        </div>
      </div>

      <div id={props.id} className={props.className} onDragOver={dragOver}>
        <table className="mr-3 mt-1 float-right">
          <tr className="row">
            <td className="d-flex flex-row">
              <button
                className="merge-btn mr-1 btn btn-outline-primary"
                type="button"
                style={{ width: "26px", height: "34px" }}
                onClick={() => sendMessage({ msg: "all", id: props.id })}
              >
                <div className="tip">
                  <MdVerticalAlignCenter
                    style={{
                      transform: "rotate(90deg)",
                      position: "relative",
                      left: "-10px",
                      top: "-3px",
                    }}
                    color="black"
                    size="1.3rem"
                  />
                  <span className="tiptext-merge">
                    {translate("mergeALLtabs")}
                  </span>
                </div>
              </button>
              <button
                className="merge-left-btn mr-1 btn btn-outline-warning"
                type="button"
                style={{ width: "26px", height: "34px" }}
                onClick={() => sendMessage({ msg: "left", id: props.id })}
              >
                <div className="tip">
                  <BiArrowToRight
                    style={{
                      position: "relative",
                      left: "-10px",
                      top: "-3px",
                    }}
                    color="black"
                    size="1.3rem"
                  />
                  <span className="tiptext-merge">
                    {translate("mergeLEFTtabs")}
                  </span>
                </div>
              </button>
              <button
                className="merge-right-btn mr-4 btn btn-outline-warning"
                type="button"
                style={{ width: "26px", height: "34px" }}
                onClick={() => sendMessage({ msg: "right", id: props.id })}
              >
                <div className="tip">
                  <BiArrowToRight
                    style={{
                      transform: "rotate(180deg)",
                      position: "relative",
                      left: "-10px",
                      top: "-3px",
                    }}
                    color="black"
                    size="1.3rem"
                  />
                  <span className="tiptext-merge">
                    {translate("mergeRIGHTtabs")}
                  </span>
                </div>
              </button>
            </td>

            <td className="d-flex flex-row">
              <button
                className="open-group-btn mr-1 p-1 btn btn-light btn-outline-success"
                onClick={(e) => openAllTabsInGroup(e)}
              >
                <div className="tip">
                  <FaWindowRestore color="forestgreen" />
                  <span className="tiptext">{translate("openGroup")}</span>
                </div>
              </button>
              <button
                className="delete-group-btn mr-4 p-1 btn btn-light btn-outline-danger"
                onClick={(e) => deleteGroup(e)}
              >
                <div className="tip">
                  <CgRemove color="red" />
                  <span className="tiptext">{translate("deleteGroup")}</span>
                </div>
              </button>
              <button
                className="show-hide-btn mr-1 p-1 btn btn-light btn-outline-info"
                onClick={(e) => toggleGroup(e)}
              >
                <div className="tip">
                  {hide ? (
                    <FcCollapse style={{ transform: "rotate(180deg)" }} />
                  ) : (
                    <FcCollapse style={{ transform: "rotate(0deg)" }} />
                  )}
                  <span className="tiptext">
                    {hide ? translate("showTabs") : translate("hideTabs")}
                  </span>
                </div>
              </button>
            </td>
          </tr>
        </table>

        {props.children}
      </div>
    </div>
  );
}

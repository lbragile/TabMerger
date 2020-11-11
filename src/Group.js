import React, { useEffect, useRef, useState } from "react";
import EdiText from "react-editext";

import { FcCollapse } from "react-icons/fc";
import { CgRemove } from "react-icons/cg";
import { FaWindowRestore } from "react-icons/fa";
import { BsPencilSquare } from "react-icons/bs";

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

  function handleTitleChange(val) {
    if (val.length < 15) {
      setTitle(val);
      var groups = JSON.parse(window.localStorage.getItem("groups"));
      groups[props.id].title = val;
      window.localStorage.setItem("groups", JSON.stringify(groups));
    } else {
      alert("Titles must be less than 15 characters long!");
      window.location.reload();
    }
  }

  function handleColorChange(e) {
    backgroundColor(e.target);
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    groups[props.id].color = e.target.value;
    window.localStorage.setItem("groups", JSON.stringify(groups));
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
    var tabs = e.target
      .closest(".group")
      .querySelectorAll("div[draggable='true']");
    [...tabs].forEach((tab) => {
      tab.querySelector("a").click();
    });

    if (
      JSON.parse(window.localStorage.getItem("settings")).restore !== "keep"
    ) {
      e.target
        .closest(".group")
        .querySelector(".float-right")
        .lastChild.click();
    }
  }

  function deleteGroup(e) {
    var group = e.target.closest(".group");

    // update localstorage
    var ls_groups = JSON.parse(window.localStorage.getItem("groups"));
    delete ls_groups[group.id];

    // must rename all keys properly
    var new_groups = {};
    if (Object.values(ls_groups).length > 0) {
      Object.values(ls_groups).forEach((value, index) => {
        new_groups["group-" + index] = value;
      });
    } else {
      new_groups["group-0"] = {
        title: JSON.parse(window.localStorage.getItem("settings")).title,
        color: JSON.parse(window.localStorage.getItem("settings")).color,
        created: new Date(Date.now()).toString(),
        tabs: [],
      };
    }
    window.localStorage.setItem("groups", JSON.stringify(new_groups));
    window.location.reload();
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
    date_parts[0] = date_parts[0] + ".";
    date_parts[1] = date_parts[1] + ".";
    date_parts[2] = date_parts[2] + ",";
    date_parts[6] = "PDT";
    date_parts.splice(5, 1);
    date_parts.splice(6, 2);

    // time decreases by 1 hour on reloads for some reason?
    var time = date_parts[4].split(":");
    time[0] = parseInt(time[0]) + 1;
    date_parts[4] = time.join(":");

    return date_parts.join(" ");
  }

  return (
    <div className="my-3">
      <div className="created float-right mr-1">
        <b>Created:</b>{" "}
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
          value={title}
          editButtonContent={
            <div className="tip mb-1">
              <BsPencilSquare color="saddlebrown" />
              <span className="tiptext-bottom">Edit Group Title</span>
            </div>
          }
          onSave={(val) => {
            handleTitleChange(val);
          }}
        />
        <div className="tip ml-3 mb-1">
          <input
            ref={colorRef}
            defaultValue={props.color}
            onChange={(e) => handleColorChange(e)}
            type="color"
          />
          <span className="tiptext-bottom">Pick Group Color</span>
        </div>
      </div>

      <div id={props.id} className={props.className} onDragOver={dragOver}>
        <div className="mr-2 mt-1 float-right d-flex flex-column align-items-center">
          <button
            className="mt-1 p-1 btn btn-light btn-outline-info"
            onClick={(e) => toggleGroup(e)}
          >
            <div className="tip">
              {hide ? (
                <FcCollapse style={{ transform: "rotate(180deg)" }} />
              ) : (
                <FcCollapse style={{ transform: "rotate(0deg)" }} />
              )}
              <span className="tiptext-side">
                {hide ? "Show Tabs" : "Hide Tabs"}
              </span>
            </div>
          </button>
          <button
            className="mt-1 p-1 btn btn-light btn-outline-success"
            onClick={(e) => openAllTabsInGroup(e)}
          >
            <div className="tip">
              <FaWindowRestore color="forestgreen" />
              <span className="tiptext-side">Open Group</span>
            </div>
          </button>
          <button
            className="mt-1 p-1 btn btn-light btn-outline-danger"
            onClick={(e) => deleteGroup(e)}
          >
            <div className="tip">
              <CgRemove color="red" />
              <span className="tiptext-side">Delete Group</span>
            </div>
          </button>
        </div>

        {props.children}
      </div>
    </div>
  );
}

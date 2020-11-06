import React, { useEffect, useRef, useState } from "react";
import { Button } from "react-bootstrap";
import EdiText from "react-editext";

import "./Group.css";
export default function Group(props) {
  const [title, setTitle] = useState(props.title);

  function backgroundColor(target) {
    var children = target.parentNode.parentNode.parentNode.children;
    [...children].forEach((child) => {
      child.style.background = target.value;
    });
  }

  const colorRef = useRef();
  useEffect(() => {
    backgroundColor(colorRef.current);
  }, []);

  function handleTitleChange(val) {
    setTitle(val);
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    groups[props.id].title = val;
    window.localStorage.setItem("groups", JSON.stringify(groups));
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
      .closest("div")
      .nextSibling.querySelectorAll("div[draggable='true']");
    [...tabs].forEach((tab) => {
      tab.querySelector("a").click();
    });
  }

  function deleteGroup(e) {
    var group = e.target.closest(".group");

    // remove from window
    group.previousSibling.remove();
    group.remove();

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
      new_groups["group-0"] = { title: "General", color: "#c9c9c9", tabs: [] };
    }
    window.localStorage.setItem("groups", JSON.stringify(new_groups));
    window.location.reload();
  }

  return (
    <div className="my-2">
      <div className="group-title d-flex justify-content-center">
        <EdiText
          className="font-weight-bold"
          type="text"
          value={title}
          onSave={(val) => {
            handleTitleChange(val);
          }}
        />
      </div>
      <div id={props.id} className={props.className} onDragOver={dragOver}>
        <div className="row mx-3 mt-2 float-right d-flex flex-row align-items-center">
          <input
            ref={colorRef}
            defaultValue={props.color}
            onChange={(e) => handleColorChange(e)}
            type="color"
          />
          <Button
            variant="light"
            className="mx-1"
            onClick={(e) => openAllTabsInGroup(e)}
          >
            <b>Open All</b>
          </Button>
          <Button
            variant="light"
            className="mx-1"
            onClick={(e) => deleteGroup(e)}
          >
            <b>Delete Group</b>
          </Button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

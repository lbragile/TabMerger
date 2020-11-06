import React, { useEffect, useRef, useState } from "react";
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
        <div className="row mx-3 mt-2 float-right">
          <b className="mr-1">Background Color</b>
          <input
            ref={colorRef}
            defaultValue={props.color}
            onChange={(e) => handleColorChange(e)}
            type="color"
          />
        </div>
        {props.children}
      </div>
    </div>
  );
}

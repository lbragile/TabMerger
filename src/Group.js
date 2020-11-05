import React, { useEffect, useRef, useState } from "react";
import EdiText from "react-editext";

import "./Group.css";
export default function Group(props) {
  const [title, setTitle] = useState(props.title);

  const drop = (e) => {
    e.preventDefault();
    const tab_id = e.dataTransfer.getData("tab_id");
    const tab = document.getElementById(tab_id);
    e.target.appendChild(tab);
  };

  const dragOver = (e) => {
    e.preventDefault();
  };

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
      <div
        id={props.id}
        className={props.className}
        onDrop={drop}
        onDragOver={dragOver}
      >
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

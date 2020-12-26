import React from "react";

export default function Button(props) {
  return (
    <button
      id={props.id}
      className={props.classes + " btn"}
      onClick={props.onClick}
    >
      <div className="tip">
        {props.children}
        <span className={props.tooltip}>{props.translate}</span>
      </div>
    </button>
  );
}

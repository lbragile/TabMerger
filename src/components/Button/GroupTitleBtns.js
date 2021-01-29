import React from "react";

import Button from "./Button";
import { GROUP_TITLE_BUTTONS } from "./button_details";

export default function GroupTitleBtns({ hidden, locked, starred, setTabTotal, setGroups }) {
  return (
    <div className="title-btn-containter row">
      {GROUP_TITLE_BUTTONS(hidden, locked, starred, setTabTotal, setGroups).map((x) => {
        return (
          <Button
            classes={x.classes}
            translate={x.translate}
            tooltip={"tiptext-group-title"}
            onClick={x.clickFn}
            key={Math.random()}
          >
            {x.icon}
          </Button>
        );
      })}
    </div>
  );
}

import React from "react";

import Button from "./Button";
import { MERGE_BUTTONS } from "./button_details";

export default function MergeBtns({ id }) {
  return (
    <div className="merging-container float-right">
      <div className="d-flex flex-column">
        {MERGE_BUTTONS(id).map((x) => {
          return (
            <Button
              classes={x.classes}
              translate={x.translate}
              tooltip={"tiptext-group-merge"}
              onClick={x.clickFn}
              key={Math.random()}
            >
              {x.icon}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

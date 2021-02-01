import React from "react";

import Button from "./Button";
import * as AppFunc from "../App/App_functions";
import * as GroupFunc from "../Group/Group_functions";

import { BiArrowToRight } from "react-icons/bi";
import { MdVerticalAlignCenter } from "react-icons/md";

export default function MergeBtns({ id }) {
  const MERGE_BUTTONS = [
    {
      classes: "merge-btn btn-for-merging btn-outline-dark",
      translate: AppFunc.translate("mergeALLtabs"),
      clickFn: () => GroupFunc.sendMessage({ msg: "all", id }),
      icon: <MdVerticalAlignCenter color="black" size="1.3rem" />,
    },
    {
      classes: "merge-left-btn btn-for-merging btn-outline-dark",
      translate: AppFunc.translate("mergeLEFTtabs"),
      clickFn: () => GroupFunc.sendMessage({ msg: "left", id }),
      icon: <BiArrowToRight color="black" size="1.3rem" />,
    },
    {
      classes: "merge-right-btn btn-for-merging btn-outline-dark",
      translate: AppFunc.translate("mergeRIGHTtabs"),
      clickFn: () => GroupFunc.sendMessage({ msg: "right", id }),
      icon: <BiArrowToRight color="black" size="1.3rem" />,
    },
  ];

  return (
    <div className="merging-container float-right">
      <div className="d-flex flex-column">
        {MERGE_BUTTONS.map((x) => {
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

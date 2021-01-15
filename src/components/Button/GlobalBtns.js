import React from "react";

import { translate } from "../App/App_functions";
import Button from "./Button";

import { GLOBAL_BUTTONS } from "./button_details.js";
import ImportBtn from "./ImportBtn.js";

export default function GlobalBtns({ syncTimestamp, group_limit, setTabTotal, setGroups }) {
  return (
    <div className="global-btn-row col">
      <p className="mx-auto alert alert-danger" id="sync-text">
        <b>{translate("sync").substr(0, 4)}:</b> <span ref={syncTimestamp}>--/--/---- @ --:--:--</span>
      </p>

      {GLOBAL_BUTTONS(syncTimestamp.current, group_limit, setTabTotal, setGroups).map((x, i) => {
        if (i <= 4 || i >= 6) {
          return (
            <span key={Math.random()}>
              <Button
                id={x.id}
                classes={"p-0 mt-2 btn-in-global d-inline-block " + x.classes}
                translate={x.translate}
                tooltip={"tiptext-global"}
                onClick={x.btnFn}
                key={Math.random()}
              >
                {x.icon}
              </Button>
              {i === 3 ? <div /> : null}
            </span>
          );
        } else {
          return <ImportBtn setTabTotal={setTabTotal} setGroups={setGroups} key={Math.random()} />;
        }
      })}
    </div>
  );
}

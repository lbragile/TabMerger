import React from "react";
import { BiImport } from "react-icons/bi";

import { translate, importJSON } from "../App/App_functions";

export default function ImportBtn({ setGroups, setTabTotal }) {
  return (
    <React.Fragment>
      <label id="import-btn" htmlFor="import-input" className="mx-2 mt-2 d-inline-block btn-in-global btn">
        <div className="tip">
          <BiImport color="black" size="1.4rem" />
          <span className="tiptext-json">{translate("importJSON")}</span>
        </div>
      </label>
      <input
        id="import-input"
        type="file"
        accept=".json"
        onChange={(e) => importJSON(e, setGroups, setTabTotal)}
      ></input>
    </React.Fragment>
  );
}

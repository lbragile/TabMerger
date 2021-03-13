import React from "react";
import { BiImport } from "react-icons/bi";

import { translate, importJSON } from "../App/App_functions";

export interface ImportBtnProps {
  user: { paid: string | boolean; tier: string };
  setTabTotal: React.Dispatch<React.SetStateAction<number>>;
  setGroups: React.Dispatch<React.SetStateAction<string>>;
}

export default function ImportBtn({ user, setGroups, setTabTotal }: ImportBtnProps): JSX.Element {
  return (
    <React.Fragment>
      <label
        id="import-btn"
        htmlFor="import-input"
        className="mx-2 mt-2 d-inline-block btn-in-global btn"
        data-tip={translate("importJSON")}
        data-for="btn-tooltip"
        data-place="bottom"
      >
        <BiImport color="black" size="1.4rem" />
      </label>
      <input
        id="import-input"
        type="file"
        accept=".json"
        onChange={(e) => importJSON(e, user, setGroups, setTabTotal)}
      ></input>
    </React.Fragment>
  );
}

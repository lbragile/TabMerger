import React from "react";

import { translate, getTabMergerLink } from "../App/App_functions";

export default function Header({ total }: { total: number }): JSX.Element {
  return (
    <React.Fragment>
      <a href={getTabMergerLink(false)} target="_blank" rel="noreferrer">
        <img id="logo-img" src="./images/logo-full-rescale.PNG" alt="TabMerger Logo" />
      </a>
      <div className="subtitle">
        <h3>{total + " " + translate(total === 1 ? "tab" : "tabs")}</h3>
      </div>
    </React.Fragment>
  );
}

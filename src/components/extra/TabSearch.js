import React from "react";

import { translate, regexSearchForTab, resetSearch } from "../App/App_functions";

import { BsInfoCircle } from "react-icons/bs";
import { AiOutlineSearch } from "react-icons/ai";

export default function TabSearch() {
  return (
    <div className="input-group search-filter my-3 mx-auto">
      <div className="input-group-prepend">
        <span className="input-group-text">
          <AiOutlineSearch color="white" />
        </span>
      </div>
      <input
        type="text"
        name="search-group"
        maxLength={20}
        placeholder={translate("searchForTabs") + "..."}
        onChange={(e) => regexSearchForTab(e)}
        onBlur={(e) => resetSearch(e)}
      />
      <div className="input-group-append">
        <span className="input-group-text">
          <div className="tip">
            <BsInfoCircle color="white" size="1rem" />
            <span className="tiptext-global-white text-left">
              #___ &rarr; {translate("group")}
              <br />
              ___ &rarr; {translate("tab")}
            </span>
          </div>
        </span>
      </div>
    </div>
  );
}

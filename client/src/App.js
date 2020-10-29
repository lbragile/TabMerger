import React, { useRef } from "react";
import Cookies from "js-cookie";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

export default function App() {
  var tabs = useRef(Cookies.get("tabs"));

  return (
    <div>
      {JSON.parse(tabs.current).map((tab) => {
        return tab.url.includes("http") && !tab.url.includes("localhost") ? (
          <div className="inline-block" key={Math.random()}>
            <img
              src={tab.favIconUrl}
              width="16"
              height="16"
              alt="icon for the url"
              className="m-2"
            />
            <a href={tab.url} target="_blank" rel="noreferrer">
              {tab.title}
            </a>
          </div>
        ) : null;
      })}
    </div>
  );
}

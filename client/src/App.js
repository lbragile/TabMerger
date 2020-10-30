import React, { useState, useEffect } from "react";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

export default function App() {
  const [tabs, setTabs] = useState([{ url: "" }]);

  useEffect(() => {
    window.addEventListener("message", (e) => {
      if (e.source !== window) return;
      setTabs(e.data.tabs);
    });
  }, []);

  return (
    <div>
      {tabs.map((tab) => {
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

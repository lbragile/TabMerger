import React, { useState, useEffect } from "react";

import "./Tabs.css";
export default function Tabs(props) {
  const [tabs, setTabs] = useState(
    JSON.parse(window.localStorage.getItem("tabs")) || []
  );

  useEffect(() => {
    props.setCounter(tabs.length);

    function triggerEvent(e) {
      /* istanbul ignore next */
      if (e.origin.includes("tests/integration") && e.source !== window) return;

      // want to only use unique tabs, if multiple identical tabs are open we only store the unique ones
      var tabs_arr = tabs;
      var combined_arr = [...tabs_arr, ...e.data.tabs];
      var unique_arr = Array.from(
        new Set(
          combined_arr.map((item) =>
            JSON.stringify({
              url: item.url,
              favIconUrl: item.favIconUrl,
              title: item.title,
            })
          )
        )
      );
      unique_arr = unique_arr.map((item) => JSON.parse(item));
      tabs_arr = unique_arr.filter(
        (item) =>
          item.url &&
          item.url.includes("http") &&
          !item.url.includes("localhost")
      );

      setTabs(tabs_arr);
      window.localStorage.setItem("tabs", JSON.stringify(tabs_arr));
    }

    window.addEventListener("message", (e) => triggerEvent(e));

    /* istanbul ignore next */
    return () => {
      window.removeEventListener("message", (e) => triggerEvent(e));
    };
  }, [tabs, props]);

  function removeTab(e) {
    var title = e.target.parentNode.querySelector("a").textContent;
    e.target.parentNode.style.display = "none";
    var tabs_arr = tabs;
    tabs_arr = tabs_arr.filter((item) => item.title !== title);
    props.setCounter(tabs_arr.length);
    setTabs(tabs_arr);
    window.localStorage.setItem("tabs", JSON.stringify(tabs_arr));
  }

  return (
    <div className="d-flex flex-column mx-4 my-2">
      {tabs.map((tab) => {
        return (
          <div className="row my-2" key={Math.random()}>
            <p className="close-tab" onClick={(e) => removeTab(e)}>
              ✖
            </p>
            <img
              className="img-tab mx-2"
              src={tab.favIconUrl}
              width="24"
              height="24"
              alt="icon for the url"
            />
            <a
              href={tab.url}
              className="a-tab"
              target="_blank"
              rel="noreferrer"
            >
              {tab.title}
            </a>
          </div>
        );
      })}
    </div>
  );
}

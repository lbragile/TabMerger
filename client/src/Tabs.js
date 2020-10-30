import React, { useState, useEffect } from "react";

export default function Tabs(props) {
  const [tabs, setTabs] = useState([{ url: "" }]);

  useEffect(() => {
    window.addEventListener("message", (e) => {
      if (e.source !== window) return;

      // want to only use unique tabs, if multiple identical tabs are open we only store the unique ones
      var tabs_arr = JSON.parse(window.localStorage.getItem("tabs"));
      if (!tabs_arr) {
        tabs_arr = [...e.data.tabs];
      } else {
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
      }

      props.setCounter(tabs_arr.length);
      setTabs(tabs_arr);
      window.localStorage.setItem("tabs", JSON.stringify(tabs_arr));
    });
  }, []);

  return (
    <div>
      {tabs.map((tab) => {
        return (
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
        );
      })}
    </div>
  );
}

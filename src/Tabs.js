import React, { useState, useEffect } from "react";

import "./Tabs.css";
export default function Tabs(props) {
  const [tabs, setTabs] = useState([{ url: "" }]);

  useEffect(() => {
    window.addEventListener("message", (e) => {
      if (
        e.source.location.href.includes("tests/integration") &&
        e.source !== window
      )
        return;

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
  });

  function removeTab(e) {
    var title = e.target.parentNode.querySelector("a").textContent;
    e.target.parentNode.style.display = "none";
    console.log(title);
    var tabs_arr = JSON.parse(window.localStorage.getItem("tabs"));
    tabs_arr = tabs_arr.filter((item) => item.title !== title);
    props.setCounter(tabs_arr.length);
    setTabs(tabs_arr);
    window.localStorage.setItem("tabs", JSON.stringify(tabs_arr));
  }
  return (
    <div className="tab-group">
      {tabs.map((tab) => {
        return tab.url ? (
          <div className="row" key={Math.random()}>
            <p className="close_btn" onClick={(e) => removeTab(e)}>
              ✖
            </p>
            <img
              src={tab.favIconUrl}
              width="24"
              height="24"
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

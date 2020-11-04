import React, { useState, useEffect } from "react";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import Tabs from "./Tabs.js";
import Group from "./Group.js";

import { Button } from "react-bootstrap";

export default function App() {
  const [counter, setCounter] = useState(0);
  const [groups, setGroups] = useState([
    <Group id="group-0" className="group" key={Math.random()}>
      <Tabs setCounter={setCounter} />
    </Group>,
  ]);

  useEffect(() => {
    // for each group, store the title, background color, and tab information
    var group_blocks = document.querySelectorAll(".group");
    var ls_entry = {};
    for (let i = 0; i < group_blocks.length; i++) {
      ls_entry[group_blocks[i].id] = {
        title: group_blocks[i].parentNode.firstChild.querySelector(
          "div[editext='view']"
        ).innerText,
        color: group_blocks[i].style.background,
      };

      var group_tabs = group_blocks[i].querySelectorAll(
        "div[draggable='true']"
      );

      var tabs_entry = [];
      for (let j = 0; j < group_tabs.length; j++) {
        tabs_entry.push({
          img: group_tabs[j].querySelector("img").src,
          a: group_tabs[j].querySelector("a").href,
          title: group_tabs[j].querySelector("a").innerText.substr(2),
        });
      }

      ls_entry[group_blocks[i].id].tabs = tabs_entry;
    }
    window.localStorage.setItem("groups", JSON.stringify(ls_entry));
  }, [groups]);

  function sendMessage() {
    chrome.runtime.sendMessage("canoomdemlnnobjpaihfioeifllgbfic", {
      msg: "get tabs",
    });
  }

  const addGroup = () => {
    setGroups([
      ...groups,
      <Group
        id={"group-" + groups.length}
        className="group"
        key={Math.random()}
      ></Group>,
    ]);
  };

  return (
    <div className="container">
      <h1>Tabify</h1>
      <h5>{counter} tabs total</h5>

      {groups}
      <div className="col">
        <Button
          className="d-block mb-2"
          id="add-group-btn"
          variant="secondary"
          type="button"
          onClick={() => addGroup()}
        >
          Add Group
        </Button>

        <Button
          id="merge-btn"
          variant="primary"
          type="button"
          onClick={() => sendMessage()}
        >
          Merge Tabs
        </Button>
      </div>
    </div>
  );
}

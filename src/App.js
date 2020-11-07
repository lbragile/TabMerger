import React, { useState, useEffect, useRef } from "react";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import Tabs from "./Tabs.js";
import Group from "./Group.js";

import { Button } from "react-bootstrap";

export default function App() {
  const defaultColor = useRef("#C9C9C9");
  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState(() => {
    var group_blocks = JSON.parse(window.localStorage.getItem("groups"));
    return group_blocks
      ? Object.keys(group_blocks).map((item) => {
          return (
            <Group
              id={item}
              className="group"
              title={group_blocks[item].title}
              color={group_blocks[item].color}
              created={new Date(group_blocks[item].created).toString()}
              key={Math.random()}
            >
              <Tabs setTabTotal={setTabTotal} id={item} />
            </Group>
          );
        })
      : [
          <Group
            id="group-0"
            className="group"
            title="General"
            color={defaultColor.current}
            created={new Date(Date.now()).toString()}
            key={Math.random()}
          >
            <Tabs setTabTotal={setTabTotal} id="group-0" />
          </Group>,
        ];
  });

  // https://stackoverflow.com/a/5624139/4298115
  function rgb2hex(input) {
    var rgb = input.substr(4).replace(")", "").split(",");
    var hex = rgb.map((elem) => {
      let hex_temp = parseInt(elem).toString(16);
      return hex_temp.length === 1 ? "0" + hex_temp : hex_temp;
    });

    return "#" + hex.join("");
  }

  useEffect(() => {
    // once a group is added: for each group, store the title, background color, and tab information
    var group_blocks = document.querySelectorAll(".group");
    var ls_entry = {};
    for (let i = 0; i < group_blocks.length; i++) {
      ls_entry[group_blocks[i].id] = {
        title: group_blocks[i].parentNode.querySelector("div[editext='view']")
          .innerText,
        color: rgb2hex(group_blocks[i].style.background),
        created: group_blocks[i].parentNode.querySelector(".created").innerText,
        tabs: [],
      };

      var group_tabs = group_blocks[i].querySelectorAll(
        "div[draggable='true']"
      );

      var tabs_entry = [];
      for (let j = 0; j < group_tabs.length; j++) {
        tabs_entry.push({
          favIconUrl: group_tabs[j].querySelector("img").src,
          url: group_tabs[j].querySelector("a").href,
          title: group_tabs[j].querySelector("a").innerText,
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
        color={defaultColor.current}
        title="Title"
        created={new Date(Date.now()).toString()}
      >
        <Tabs setTabTotal={setTabTotal} id={"group-" + groups.length} />
      </Group>,
    ]);
  };

  function openAllTabs() {
    var tabs = document.querySelectorAll(".draggable");
    tabs.forEach((tab) => {
      tab.querySelector("a").click();
    });
  }

  function deleteAllGroups() {
    window.localStorage.setItem(
      "groups",
      JSON.stringify({
        "group-0": {
          title: "General",
          color: "#c9c9c9",
          created: new Date(Date.now()).toString(),
          tabs: [],
        },
      })
    );

    window.location.reload();
  }

  return (
    <div className="container">
      <h1>Tabify</h1>
      <h5 id="tab-total">{tabTotal} tabs in total</h5>
      <div className="row">
        <Button
          id="merge-btn"
          variant="primary"
          type="button"
          onClick={() => sendMessage()}
        >
          Merge Tabs
        </Button>
        <Button
          id="open-all-btn"
          variant="dark"
          type="button"
          className="ml-1"
          onClick={() => openAllTabs()}
        >
          Open All
        </Button>
        <Button
          id="delete-all-btn"
          variant="dark"
          type="button"
          className="ml-1"
          onClick={() => deleteAllGroups()}
        >
          Delete All
        </Button>
      </div>

      {groups}

      <Button
        className="d-block mb-2"
        id="add-group-btn"
        variant="secondary"
        type="button"
        onClick={() => addGroup()}
      >
        Add Group
      </Button>
    </div>
  );
}

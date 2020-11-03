import React, { useState } from "react";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import Tabs from "./Tabs.js";
import Group from "./Group.js";

import { Button } from "react-bootstrap";

export default function App() {
  const [counter, setCounter] = useState(0);
  const [groups, setGroups] = useState([
    <Group id="group-1" className="group" key={Math.random()}>
      <Tabs setCounter={setCounter} />
    </Group>,
  ]);

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

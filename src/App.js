import React, { useState } from "react";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import Tabs from "./Tabs.js";

import { Button } from "react-bootstrap";

export default function App() {
  const [counter, setCounter] = useState(0);

  function sendMessage() {
    chrome.runtime.sendMessage("canoomdemlnnobjpaihfioeifllgbfic", {
      msg: "get tabs",
    });
  }

  return (
    <>
      <h1>Tabify</h1>
      <h5>Currently have {counter} tabs</h5>
      <Tabs setCounter={setCounter} />
      <Button
        id="merge-btn"
        variant="primary"
        type="button"
        onClick={() => sendMessage()}
      >
        Merge All Tabs in Window
      </Button>
    </>
  );
}

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import Tabs from "./Tabs.js";

import React, { useState } from "react";
export default function App() {
  const [counter, setCounter] = useState(0);

  return (
    <>
      <h1>Tabify</h1>
      <h5>Currently have {counter} tabs</h5>
      <Tabs setCounter={setCounter} />
    </>
  );
}

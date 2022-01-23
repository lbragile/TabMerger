import { useState } from "react";

import Backup from "./Backup";
import Filter from "./Filter";
import General from "./General";
import Keyboard from "./Keyboard";
import Theme from "./Theme";

import ModalHeader from "~/components/ModalHeader";
import Selector from "~/components/Selector";

export default function Settings(): JSX.Element {
  const [activeTab, setActiveTab] = useState<"General" | "Theme" | "Backup" | "Filter" | "Keyboard">("General");

  return (
    <>
      <ModalHeader title="TabMerger Settings" />

      <Selector
        opts={["General", "Theme", "Backup", "Filter", "Keyboard"]}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {activeTab === "General" && <General />}

      {activeTab === "Theme" && <Theme />}

      {activeTab === "Backup" && <Backup />}

      {activeTab === "Filter" && <Filter />}

      {activeTab === "Keyboard" && <Keyboard />}
    </>
  );
}

import { useState, useEffect } from "react";

import File from "./File";
import Text from "./Text";

import type { IGroupItemState } from "~/store/reducers/groups";
import type { TImportType } from "~/typings/settings";

import { ModalFooter, ModalHeader } from "~/components/Modal";
import Selector from "~/components/Selector";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { updateAvailable, updateActive } from "~/store/actions/groups";
import { setVisibility } from "~/store/actions/modal";

export default function Import(): JSX.Element {
  const dispatch = useDispatch();
  const dispatchWithHistory = useDispatch(true);

  const { available } = useSelector((state) => state.groups);

  const [activeTab, setActiveTab] = useState<"File" | "Text">("File");
  const [currentText, setCurrentText] = useState("");
  const [importType, setImportType] = useState<TImportType>("json");
  const [importFile, setImportFile] = useState<IGroupItemState[]>([]);

  // Reset the uploaded text & formatted groups if the activeTab is changed
  useEffect(() => {
    if (activeTab === "File") {
      setCurrentText("");
      setImportFile([]);
    }
  }, [dispatch, activeTab]);

  return (
    <>
      <ModalHeader title="TabMerger Import" />

      <Selector opts={["File", "Text"]} activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === "File" ? (
        <File setCurrentText={setCurrentText} setActiveTab={setActiveTab} setImportType={setImportType} />
      ) : (
        <Text
          currentText={currentText}
          setCurrentText={setCurrentText}
          importType={importType}
          setImportType={setImportType}
          setImportFile={setImportFile}
        />
      )}

      <ModalFooter
        showSave={importFile.length > 0}
        saveText={`Import (${importFile.length})`}
        closeText="Cancel"
        handleSave={() => {
          dispatch(updateAvailable([available[0], ...importFile]));
          dispatch(setVisibility(false));
          dispatchWithHistory(updateActive({ index: 0, id: importFile[0].id }));
        }}
      />
    </>
  );
}

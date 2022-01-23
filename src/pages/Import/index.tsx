import { useState, useEffect } from "react";

import File from "./File";
import Text from "./Text";

import ModalFooter from "~/components/ModalFooter";
import ModalHeader from "~/components/ModalHeader";
import Selector from "~/components/Selector";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { updateAvailable, updateActive } from "~/store/actions/groups";
import { setVisibility, updateImportFormattedGroups } from "~/store/actions/modal";
import { TImportType } from "~/store/reducers/modal";

export default function Import(): JSX.Element {
  const dispatch = useDispatch();

  const { available } = useSelector((state) => state.groups);

  const { importFile } = useSelector((state) => state.modal);

  const [activeTab, setActiveTab] = useState<"File" | "Text">("File");
  const [currentText, setCurrentText] = useState("");
  const [importType, setImportType] = useState<TImportType>("json");

  // Reset the uploaded text & formatted groups if the activeTab is changed
  useEffect(() => {
    if (activeTab === "File") {
      setCurrentText("");
      dispatch(updateImportFormattedGroups([]));
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
        />
      )}

      <ModalFooter
        showSave={importFile.length > 0}
        saveText={`Import (${importFile.length})`}
        closeText="Cancel"
        handleSave={() => {
          dispatch(updateAvailable([available[0], ...importFile]));
          dispatch(updateActive({ index: 0, id: importFile[0].id }));
          dispatch(setVisibility(false));
        }}
      />
    </>
  );
}

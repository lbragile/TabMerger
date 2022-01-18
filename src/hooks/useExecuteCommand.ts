import { useEffect } from "react";

import { useDispatch, useSelector } from "./useRedux";

import { updateActive } from "~/store/actions/groups";
import { setFocused } from "~/store/actions/header";
import { setModalInfo, setVisibility } from "~/store/actions/modal";

export default function useExecuteCommand() {
  const dispatch = useDispatch();

  const { available, active } = useSelector((state) => state.groups);
  const { visible } = useSelector((state) => state.modal);

  useEffect(() => {
    const commandListener = (command: string) => {
      switch (command) {
        case "currentGroup":
          dispatch(updateActive({ id: available[0].id, index: 0 }));
          break;

        case "previousGroup": {
          const newIndex = Math.max(0, active.index - 1);
          dispatch(updateActive({ id: available[newIndex].id, index: newIndex }));
          break;
        }

        case "nextGroup": {
          const newIndex = Math.min(active.index + 1, available.length - 1);
          dispatch(updateActive({ id: available[newIndex].id, index: newIndex }));
          break;
        }

        case "import": {
          dispatch(setVisibility(true));
          dispatch(
            setModalInfo({ title: "TabMerger Import", type: "import", closeText: "Cancel", saveText: "Import" })
          );
          break;
        }

        case "export": {
          dispatch(setVisibility(true));
          dispatch(
            setModalInfo({ title: "TabMerger Export", type: "export", closeText: "Close", saveText: "Save File" })
          );
          break;
        }

        case "sync": {
          dispatch(setVisibility(true));
          dispatch(setModalInfo({ title: "TabMerger Sync", type: "sync", saveText: "Sync", closeText: "Cancel" }));
          break;
        }

        case "find": {
          if (!visible) dispatch(setFocused(true));
          break;
        }

        default:
          break;
      }
    };

    chrome.commands.onCommand.addListener(commandListener);

    return () => chrome.commands.onCommand.removeListener(commandListener);
  }, [dispatch, available, active, visible]);
}

import { useEffect } from "react";
import { ActionCreators } from "redux-undo";

import useLocalStorage from "./useLocalStorage";
import { useDispatch, useSelector } from "./useRedux";

import { updateActive } from "~/store/actions/groups";
import { setFocused } from "~/store/actions/header";
import { setModalType, setVisibility } from "~/store/actions/modal";

export default function useExecuteCommand() {
  const dispatch = useDispatch();

  const { available, active } = useSelector((state) => state.groups.present);
  const { visible } = useSelector((state) => state.modal);

  const [allowShortcuts] = useLocalStorage("allowShortcuts", true);

  useEffect(() => {
    const commandListener = (command: string) => {
      if (allowShortcuts) {
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
            dispatch(setModalType("import"));
            break;
          }

          case "export": {
            dispatch(setVisibility(true));
            dispatch(setModalType("export"));
            break;
          }

          case "sync": {
            dispatch(setVisibility(true));
            dispatch(setModalType("sync"));
            break;
          }

          case "find": {
            if (!visible) dispatch(setFocused(true));
            break;
          }

          case "undoAction": {
            dispatch(ActionCreators.undo());
            break;
          }

          case "redoAction": {
            dispatch(ActionCreators.redo());
            break;
          }

          default:
            break;
        }
      }
    };

    chrome.commands.onCommand.addListener(commandListener);

    return () => chrome.commands.onCommand.removeListener(commandListener);
  }, [dispatch, available, active, visible, allowShortcuts]);
}

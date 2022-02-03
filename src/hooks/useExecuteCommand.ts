import { useCallback, useEffect } from "react";

import useLocalStorage from "./useLocalStorage";
import { useDispatch, useSelector } from "./useRedux";

import type { TRootActions } from "~/typings/redux";

import { updateActive, updateAvailable } from "~/store/actions/groups";
import { setFocused } from "~/store/actions/header";
import { updatePosition } from "~/store/actions/history";
import { setModalType, setVisibility } from "~/store/actions/modal";
import groupsReducer from "~/store/reducers/groups";

export default function useExecuteCommand() {
  const dispatch = useDispatch();
  const dispatchWithHistory = useDispatch(true);

  const { available, active } = useSelector((state) => state.groups);
  const { visible } = useSelector((state) => state.modal);
  const { actions, anchorState, pos } = useSelector((state) => state.history);

  const [allowShortcuts] = useLocalStorage("allowShortcuts", true);

  const undoRedoHandler = useCallback(
    (end: number) => {
      const { available: newAvailable, active: newActive } =
        end === 0
          ? anchorState
          : actions.slice(0, end).reduce((prev, item) => groupsReducer(prev, item as TRootActions), anchorState);

      dispatch(updatePosition(end));
      dispatch(updateAvailable(newAvailable));
      dispatch(updateActive(newActive));
    },
    [dispatch, actions, anchorState]
  );

  useEffect(() => {
    const commandListener = (command: string) => {
      if (allowShortcuts) {
        switch (command) {
          case "currentGroup":
            dispatchWithHistory(updateActive({ id: available[0].id, index: 0 }));
            break;

          case "previousGroup": {
            const newIndex = Math.max(0, active.index - 1);
            dispatchWithHistory(updateActive({ id: available[newIndex].id, index: newIndex }));
            break;
          }

          case "nextGroup": {
            const newIndex = Math.min(active.index + 1, available.length - 1);
            dispatchWithHistory(updateActive({ id: available[newIndex].id, index: newIndex }));
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
            const newPos = pos - 1;
            if (newPos >= 0) {
              undoRedoHandler(newPos);
            }

            break;
          }

          case "redoAction": {
            const newPos = pos + 1;
            if (newPos <= actions.length) {
              undoRedoHandler(newPos);
            }

            break;
          }

          default:
            break;
        }
      }
    };

    chrome.commands.onCommand.addListener(commandListener);

    return () => chrome.commands.onCommand.removeListener(commandListener);
  }, [dispatch, dispatchWithHistory, available, active, visible, allowShortcuts, undoRedoHandler, pos, actions]);
}

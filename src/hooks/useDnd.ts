import { useCallback } from "react";

import useLocalStorage from "./useLocalStorage";
import { useDispatch, useSelector } from "./useRedux";

import type { BeforeCapture, DragStart, DropResult } from "react-beautiful-dnd";

import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE, DEFAULT_WINDOW_TITLE } from "~/constants/defaults";
import { isWindowDrag, isTabDrag, isGroupDrag } from "~/constants/dragRegExp";
import { updateDragOriginType, updateIsDragging, resetDnDInfo } from "~/store/actions/dnd";
import {
  addWindow,
  addGroup,
  updateTabsFromSidePanelDnd,
  updateTabsFromGroupDnd,
  updateWindowsFromSidePanelDnd,
  updateWindowsFromGroupDnd,
  updateGroupOrder,
  updateActive,
  clearEmptyWindows,
  clearEmptyGroups
} from "~/store/actions/groups";
import { toggleWindowTabsVisibility } from "~/utils/helper";

export default function useDnd() {
  const dispatch = useDispatch();
  const dispatchWithHistory = useDispatch(true);

  const [groupTitle] = useLocalStorage("groupTitle", DEFAULT_GROUP_TITLE);
  const [groupColor] = useLocalStorage("groupColor", DEFAULT_GROUP_COLOR);
  const [windowTitle] = useLocalStorage("windowTitle", DEFAULT_WINDOW_TITLE);

  const { active, available } = useSelector((state) => state.groups);

  const { index } = active;

  const onBeforeCapture = useCallback(
    ({ draggableId }: BeforeCapture) => {
      const windowDrag = isWindowDrag(draggableId);
      const tabDrag = isTabDrag(draggableId);

      if (windowDrag) {
        // Hide tabs during a window drag
        toggleWindowTabsVisibility(draggableId, false);
      } else if (tabDrag) {
        // Add window to end of group (only if not in the first group)
        index > 0 && dispatch(addWindow({ index, name: windowTitle }));
      }

      if (windowDrag || tabDrag) {
        // Add group to end of side panel on both tab and window drag types
        dispatch(addGroup({ title: groupTitle, color: groupColor }));
      }
    },
    [dispatch, index, groupTitle, groupColor, windowTitle]
  );

  const onDragStart = useCallback(
    ({ draggableId }: DragStart) => {
      dispatch(updateDragOriginType(draggableId));
      dispatch(updateIsDragging(true));
    },
    [dispatch]
  );

  const onDragEnd = useCallback(
    ({ source, destination, combine, draggableId }: DropResult) => {
      const [isTab, isWindow, isGroup] = [isTabDrag, isWindowDrag, isGroupDrag].map((cb) => cb(draggableId));
      const commonPayload = { index, source };
      const sidePanelPayload = { ...commonPayload, combine };
      const destPayload = { ...commonPayload, destination };

      const isValidCombine = combine && Number(combine.draggableId.split("-")[1]) > 0;
      const isValidDndWithinGroup = destination && destination.droppableId !== "sidePanel";

      if (isTab) {
        isValidCombine && dispatchWithHistory(updateTabsFromSidePanelDnd({ ...sidePanelPayload, name: windowTitle }));
        isValidDndWithinGroup && dispatchWithHistory(updateTabsFromGroupDnd(destPayload));
      } else if (isWindow) {
        // Re-show the tabs since the drag ended
        toggleWindowTabsVisibility(draggableId, true);

        isValidCombine && dispatchWithHistory(updateWindowsFromSidePanelDnd(sidePanelPayload));
        isValidDndWithinGroup && dispatchWithHistory(updateWindowsFromGroupDnd(destPayload));
      } else if (isGroup && destination && destination.index > 0) {
        // Only swap if the destination exists (valid) and is below the first group
        dispatch(updateGroupOrder({ source, destination }));

        // Update active group if it does not match the draggable
        if (destination.index !== source.index) {
          dispatchWithHistory(updateActive({ id: available[destination.index].id, index: destination.index }));
        }
      }

      dispatch(resetDnDInfo());

      /**
       * Must clear the windows in the current group first, then clear the group
       * @note Only relevant for tab or window dragging since a group drag does not add either a (temporary) window or group
       */
      if (isTab || isWindow) {
        dispatch(clearEmptyWindows({ index }));
        dispatch(clearEmptyGroups(active));
      }
    },
    [dispatch, dispatchWithHistory, index, available, windowTitle, active]
  );

  return { onBeforeCapture, onDragStart, onDragEnd };
}

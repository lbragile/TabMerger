import { useCallback } from "react";
import { BeforeCapture, DragStart, DragUpdate, DropResult } from "react-beautiful-dnd";
import { isWindowDrag, isTabDrag, isGroupDrag } from "../constants/dragRegExp";
import { toggleWindowTabsVisibility } from "../utils/helper";
import { useDispatch, useSelector } from "./useRedux";
import GROUPS_CREATORS from "../store/actions/groups";
import DND_CREATORS from "../store/actions/dnd";

export default function useDnd(sidePanelRef: React.MutableRefObject<HTMLDivElement | null>) {
  const dispatch = useDispatch();

  const { active, available } = useSelector((state) => state.groups);
  const { dragType } = useSelector((state) => state.dnd);

  const onBeforeCapture = useCallback(
    ({ draggableId }: BeforeCapture) => {
      const windowDrag = isWindowDrag(draggableId);
      const tabDrag = isTabDrag(draggableId);

      if (windowDrag) {
        // hide tabs during a window drag
        toggleWindowTabsVisibility(draggableId, false);
      } else if (tabDrag) {
        // add window to end of group
        dispatch(GROUPS_CREATORS.addWindow({ index: active.index }));
      }

      if (windowDrag || tabDrag) {
        // add group to end of side panel on both tab and window drag types
        dispatch(GROUPS_CREATORS.addGroup());
      }
    },
    [dispatch, active.index]
  );

  const onDragStart = useCallback(
    ({ draggableId }: DragStart) => {
      dispatch(DND_CREATORS.updateDragOriginType(draggableId));
      dispatch(DND_CREATORS.updateIsDragging(true));
    },
    [dispatch]
  );

  const onDragUpdate = useCallback(
    ({ destination }: DragUpdate) => {
      if (isGroupDrag(dragType) && sidePanelRef.current) {
        sidePanelRef.current.style.background = destination && destination.index > 0 ? "#d5ffd5" : "#ffd3d3";
        sidePanelRef.current.style.borderRadius = "4px";
      }
    },
    [dragType, sidePanelRef]
  );

  const onDragEnd = useCallback(
    ({ source, destination, combine, draggableId }: DropResult) => {
      const [isTab, isWindow, isGroup] = [isTabDrag, isWindowDrag, isGroupDrag].map((cb) => cb(draggableId));
      const payload = { index: active.index, source };
      const spPayload = { ...payload, combine };
      const destPayload = { ...payload, destination };

      const isValidCombine = combine && Number(combine.draggableId.split("-")[1]) > 0;
      const isValidDndWithinGroup = destination && destination.droppableId !== "sidePanel";

      if (isTab) {
        isValidCombine && dispatch(GROUPS_CREATORS.updateTabsFromSidePanelDnd(spPayload));
        isValidDndWithinGroup && dispatch(GROUPS_CREATORS.updateTabsFromGroupDnd(destPayload));
      } else if (isWindow) {
        // re-show the tabs since the drag ended
        toggleWindowTabsVisibility(draggableId, true);

        isValidCombine && dispatch(GROUPS_CREATORS.updateWindowsFromSidePanelDnd(spPayload));
        isValidDndWithinGroup && dispatch(GROUPS_CREATORS.updateWindowsFromGroupDnd(destPayload));
      } else if (isGroup && destination && destination.index > 0) {
        // only swap if the destination exists (valid) and is below "Awaiting Storage"
        dispatch(GROUPS_CREATORS.updateGroupOrder({ source, destination }));

        // update active group if it does not match the draggable
        if (destination.index !== source.index) {
          dispatch(GROUPS_CREATORS.updateActive({ id: available[destination.index].id, index: destination.index }));
        }
      }

      dispatch(DND_CREATORS.resetDnDInfo());

      /**
       * must clear the windows in the current group first, then clear the group
       * @note Only relevant for tab or window dragging since a group drag does not add either a (temporary) window or group
       */
      if (isTab || isWindow) {
        dispatch(GROUPS_CREATORS.clearEmptyWindows({ index: active.index }));
        dispatch(GROUPS_CREATORS.clearEmptyGroups());
      }

      // For group dnd, reset back to initial styling
      if (isGroup && sidePanelRef.current) {
        sidePanelRef.current.style.background = "initial";
        sidePanelRef.current.style.borderRadius = "initial";
      }
    },
    [dispatch, active.index, available, sidePanelRef]
  );

  return { onBeforeCapture, onDragStart, onDragUpdate, onDragEnd };
}

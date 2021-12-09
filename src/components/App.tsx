import React, { useCallback, useRef } from "react";
import styled from "styled-components";
import { useSelector } from "../hooks/useSelector";
import useUpdateWindows from "../hooks/useUpdateWindows";
import { GlobalStyle } from "../styles/Global";
import Header from "./Header";
import SidePanel from "./SidePanel";
import Windows from "./Windows";
import { BeforeCapture, DragDropContext, DragStart, DragUpdate, DropResult } from "react-beautiful-dnd";
import { useDispatch } from "../hooks/useDispatch";
import GROUPS_CREATORS from "../store/actions/groups";
import DND_CREATORS from "../store/actions/dnd";
import { isGroupDrag, isTabDrag, isWindowDrag } from "../constants/dragRegExp";
import { toggleWindowTabsVisibility } from "../utils/helper";
import useStorage from "../hooks/useStorage";

const Container = styled.div`
  width: 780px;
  height: 600px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const MainArea = styled.div`
  display: grid;
  grid-template-columns: minmax(210px, 1fr) 3fr;
  column-gap: 16px;
  align-items: start;
  padding: 10px 8px;
`;

export default function App(): JSX.Element {
  const dispatch = useDispatch();

  const timeoutGroupDrag = useRef(0);

  const { filterChoice } = useSelector((state) => state.header);
  const { filteredGroups } = useSelector((state) => state.filter);
  const { active, available } = useSelector((state) => state.groups);
  const { canDrop, dragType } = useSelector((state) => state.dnd);

  useStorage({ available, active });
  useUpdateWindows();

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

  const onDragUpdate = useCallback(
    ({ combine, destination }: DragUpdate) => {
      if ((isGroupDrag(dragType) || combine?.droppableId === "sidePanel") && !timeoutGroupDrag.current) {
        timeoutGroupDrag.current = setTimeout(() => {
          dispatch(
            DND_CREATORS.updateCanDropGroup(Number(combine?.draggableId.split("-")?.[1] ?? destination?.index) > 1)
          );
        }, 100) as unknown as number;
      } else {
        clearTimeout(timeoutGroupDrag.current);
        timeoutGroupDrag.current = 0;
      }
    },
    [dispatch, dragType]
  );

  const onDragStart = useCallback(
    ({ draggableId }: DragStart) => {
      dispatch(DND_CREATORS.updateDragOriginType(draggableId));
      dispatch(DND_CREATORS.updateIsDragging(true));
    },
    [dispatch]
  );

  const onDragEnd = useCallback(
    ({ source, destination, combine, draggableId }: DropResult) => {
      const [isTab, isWindow, isGroup] = [isTabDrag, isWindowDrag, isGroupDrag].map((cb) => cb(draggableId));
      const payload = { index: active.index, source };
      const spPayload = { ...payload, combine };
      const destPayload = { ...payload, destination };

      /** @note Combine is only present on side panel dnd combine (tab and window) */
      if (isTab) {
        combine
          ? canDrop && dispatch(GROUPS_CREATORS.updateTabsFromSidePanelDnd(spPayload))
          : dispatch(GROUPS_CREATORS.updateTabsFromGroupDnd(destPayload));
      } else if (isWindow) {
        // re-show the tabs since the drag ended
        toggleWindowTabsVisibility(draggableId, true);

        combine
          ? canDrop && dispatch(GROUPS_CREATORS.updateWindowsFromSidePanelDnd(spPayload))
          : dispatch(GROUPS_CREATORS.updateWindowsFromGroupDnd(destPayload));
      } else if (isGroup && destination && destination.index > 1) {
        // only swap if the destination exists (valid) and is below "Duplicates"
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
    },
    [dispatch, active.index, available, canDrop]
  );

  return (
    <Container>
      <GlobalStyle />
      <Header />

      <DragDropContext
        onBeforeCapture={onBeforeCapture}
        onDragUpdate={onDragUpdate}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {(filterChoice === "tab" || (filterChoice === "group" && filteredGroups.length > 0)) && (
          <MainArea>
            <SidePanel />

            <Windows />
          </MainArea>
        )}
      </DragDropContext>
    </Container>
  );
}

import React, { useCallback } from "react";
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
  width: 600px;
  height: 600px;
  display: flex;
  flex-direction: column;
  align-items: center;
  outline: 1px solid black;
`;

const MainArea = styled.div`
  display: grid;
  grid-template-columns: 1fr 355px;
  column-gap: 20px;
  align-items: start;
  height: 524px;
  margin-top: 13px;
`;

export default function App(): JSX.Element {
  const dispatch = useDispatch();

  const { filterChoice } = useSelector((state) => state.header);
  const { filteredGroups } = useSelector((state) => state.filter);
  const { active, available } = useSelector((state) => state.groups);
  const { dragOverGroup, dragType } = useSelector((state) => state.dnd);

  useStorage("groups");
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
    ({ destination }: DragUpdate) => {
      if (destination?.droppableId === "sidePanel" && isGroupDrag(dragType)) {
        dispatch(DND_CREATORS.updateCanDropGroup(destination.index > 1));
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
    ({ source, destination, draggableId }: DropResult) => {
      if (isTabDrag(draggableId)) {
        dispatch(GROUPS_CREATORS.updateTabs({ index: active.index, source, destination, dragOverGroup }));
      } else if (isWindowDrag(draggableId)) {
        // re-show the tabs since the drag ended
        toggleWindowTabsVisibility(draggableId, true);

        dispatch(GROUPS_CREATORS.updateWindows({ index: active.index, dnd: { source, destination }, dragOverGroup }));
      } else if (isGroupDrag(draggableId)) {
        // only swap if the destination exists (valid) and is below "Duplicates"
        if (destination && destination.index > 1) {
          dispatch(GROUPS_CREATORS.updateGroupOrder({ source, destination }));

          // update active group if it does not match the draggable
          if (destination.index !== source.index) {
            dispatch(GROUPS_CREATORS.updateActive({ id: available[destination.index].id, index: destination.index }));
          }
        }
      }

      dispatch(DND_CREATORS.resetDnDInfo());

      // must clear the windows in the current group first, then clear the group
      dispatch(GROUPS_CREATORS.clearEmptyWindows({ index: active.index }));
      dispatch(GROUPS_CREATORS.clearEmptyGroups());
    },
    [dispatch, active.index, dragOverGroup, available]
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

import React, { useCallback } from "react";
import styled from "styled-components";
import { useSelector } from "../hooks/useSelector";
import useUpdateWindows from "../hooks/useUpdateWindows";
import { GlobalStyle } from "../styles/Global";
import Header from "./Header";
import SidePanel from "./SidePanel";
import Windows from "./Windows";
import { BeforeCapture, DragDropContext, DragStart, DropResult } from "react-beautiful-dnd";
import { useDispatch } from "../hooks/useDispatch";
import { updateTabs, updateWindows } from "../store/actions/groups";
import DND_CREATORS from "../store/actions/dnd";
import { isTabDrag, isWindowDrag } from "../constants/dragRegExp";
import { toggleWindowTabsVisibility } from "../utils/helper";

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
  const { active } = useSelector((state) => state.groups);
  const { dragOverGroup } = useSelector((state) => state.dnd);

  useUpdateWindows();

  const onBeforeCapture = useCallback(({ draggableId }: BeforeCapture) => {
    if (isWindowDrag(draggableId)) {
      // hide tabs during a window drag
      toggleWindowTabsVisibility(draggableId, false);
    }
  }, []);

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
        dispatch(updateTabs({ index: active.index, source, destination, dragOverGroup }));
      } else if (isWindowDrag(draggableId)) {
        // re-show the tabs since the drag ended
        toggleWindowTabsVisibility(draggableId, true);

        dispatch(updateWindows({ index: active.index, dnd: { source, destination }, dragOverGroup }));
      } else {
        // group drag
      }

      dispatch(DND_CREATORS.resetDnDInfo());
    },
    [dispatch, active.index, dragOverGroup]
  );

  return (
    <Container>
      <GlobalStyle />
      <Header />

      <DragDropContext onBeforeCapture={onBeforeCapture} onDragStart={onDragStart} onDragEnd={onDragEnd}>
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

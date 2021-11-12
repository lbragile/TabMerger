import React, { useCallback } from "react";
import styled from "styled-components";
import { useSelector } from "../hooks/useSelector";
import useUpdateWindows from "../hooks/useUpdateWindows";
import { GlobalStyle } from "../styles/Global";
import Header from "./Header";
import SidePanel from "./SidePanel";
import Windows from "./Windows";
import { DragDropContext, DragStart, DropResult } from "react-beautiful-dnd";
import { useDispatch } from "../hooks/useDispatch";
import { updateDragOriginType, updateIsDragging } from "../store/actions/dnd";
import { updateTabs, updateWindows } from "../store/actions/groups";

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

  useUpdateWindows();

  const onDragStart = useCallback(
    (initial: DragStart) => {
      dispatch(updateDragOriginType(initial.draggableId));
      dispatch(updateIsDragging(true));
    },
    [dispatch]
  );

  const onDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination, draggableId } = result;

      if (draggableId.includes("tab")) {
        // tab drag
        dispatch(updateTabs({ index: active.index, source, destination }));
      } else if (/window-\d+-group-\d+/i.test(draggableId)) {
        // window drag
        dispatch(updateWindows({ index: active.index, dnd: { source, destination } }));
      } else {
        // group drag
      }

      dispatch(updateIsDragging(false));
    },
    [dispatch, active.index]
  );

  return (
    <Container>
      <GlobalStyle />
      <Header />

      <DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
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

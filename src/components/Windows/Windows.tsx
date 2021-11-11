import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { Scrollbar } from "../../styles/Scrollbar";
import Information from "./Information";
import SearchResult from "../SearchResult";
import Window from "./Window";
import { DragDropContext, DropResult } from "react-beautiful-dnd";

const Container = styled.div`
  height: 100%;
  overflow: hidden;
`;

const Column = styled(Scrollbar)<{ $searching: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: ${({ $searching }) => ($searching ? "412px" : "460px")};
  overflow: auto;
`;

export default function Windows(): JSX.Element {
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { filteredTabs } = useSelector((state) => state.filter);
  const { active, available } = useSelector((state) => state.groups);
  const { index } = active;
  const { windows, info, name, updatedAt } = available[index];

  const hasMoreThanOneFilteredTab = typing ? filteredTabs.some((item) => item.length > 0) : true;

  const handleTabDragEnd = (result: DropResult) => {
    console.log(result);
  };

  return (
    <Container>
      <Information info={info} name={name} updatedAt={updatedAt} index={index} />

      {typing && filterChoice === "tab" && <SearchResult type="tab" />}

      <Column $searching={typing}>
        <DragDropContext onDragEnd={handleTabDragEnd}>
          {hasMoreThanOneFilteredTab && windows.map((window, i) => <Window key={i} {...window} index={i} />)}
        </DragDropContext>
      </Column>
    </Container>
  );
}

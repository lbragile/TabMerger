import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { Scrollbar } from "../../styles/Scrollbar";
import Information from "./Information";
import SearchResult from "../SearchResult";
import Window from "./Window";
// import { updateWindows } from "../../store/actions/groups";
// import { useDispatch } from "../../hooks/useDispatch";

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
  // const dispatch = useDispatch();
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { filteredTabs } = useSelector((state) => state.filter);
  const { active, available } = useSelector((state) => state.groups);
  const { index } = active;
  const { windows, info, name, updatedAt } = available[index];

  const hasMoreThanOneFilteredTab = typing ? filteredTabs.some((item) => item.length > 0) : true;

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // if (index > 1) {
    //   const { data, windowIdx, sourceGroupIdx } = JSON.parse(e.dataTransfer.getData("text"));

    //   // remove window from source
    //   const sourceWindows = [...available[sourceGroupIdx].windows];
    //   sourceWindows.splice(windowIdx, 1);
    //   dispatch(updateWindows({ index: sourceGroupIdx, windows: sourceWindows }));

    //   // add window to destination
    //   dispatch(updateWindows({ index, windows: [...windows, data] }));

    //   e.dataTransfer.clearData();
    // }
  };

  return (
    <Container>
      <Information info={info} name={name} updatedAt={updatedAt} index={index} />

      {typing && filterChoice === "tab" && <SearchResult type="tab" />}

      <Column $searching={typing} onDragOver={onDragOver} onDrop={onDrop}>
        {hasMoreThanOneFilteredTab &&
          windows.map((window, i) => <Window key={i} {...window} index={i} groupIdx={index} />)}
      </Column>
    </Container>
  );
}

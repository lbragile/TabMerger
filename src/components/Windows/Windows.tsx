import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { Scrollbar } from "../../styles/Scrollbar";
import Information from "./Information";
import SearchResult from "../SearchResult";
import Window from "./Window";

const Column = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 460px;
  overflow: auto;
`;

export default function Windows(): JSX.Element {
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { filteredTabs } = useSelector((state) => state.filter);
  const { active, available } = useSelector((state) => state.groups);
  const { index } = active;
  const { windows, info, name, updatedAt } = available[index];

  const hasMoreThanOneFilteredTab = typing ? filteredTabs.some((item) => item.length > 0) : true;

  return (
    <div>
      <Information info={info} name={name} updatedAt={updatedAt} index={index} />

      {typing && filterChoice === "tab" && <SearchResult type="tab" />}

      {hasMoreThanOneFilteredTab && (
        <Column>
          {windows.map((window, i) => (
            <Window key={i} {...window} index={i} />
          ))}
        </Column>
      )}
    </div>
  );
}

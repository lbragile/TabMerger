import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { Scrollbar } from "../../styles/Scrollbar";
import Information from "./Information";
import SearchResult from "../SearchResult";
import Window from "./Window";
import { Draggable, Droppable } from "react-beautiful-dnd";
import { isWindowDrag } from "../../constants/dragRegExp";

const WindowsContainer = styled(Scrollbar)<{ $searching: boolean; $searchingGroup: boolean; $draggedOver: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  height: ${({ $searching, $searchingGroup }) => ($searching ? "424px" : $searchingGroup ? "416px" : "472px")};
  border: 1px dashed ${({ $draggedOver }) => ($draggedOver ? "blue" : "transparent")};
  border-radius: 4px;
`;

export default function Windows(): JSX.Element {
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { filteredTabs } = useSelector((state) => state.filter);
  const { active, available } = useSelector((state) => state.groups);
  const { dragType } = useSelector((state) => state.dnd);
  const { index } = active;
  const { windows, info, name, updatedAt } = available[index];

  const hasMoreThanOneFilteredTab = typing ? filteredTabs.some((item) => item.length > 0) : true;
  const tabSearching = typing && filterChoice === "tab";
  const groupSearching = typing && filterChoice === "group";

  return (
    <div>
      <Information info={info} name={name} updatedAt={updatedAt} index={index} />

      {tabSearching && <SearchResult type="tab" />}

      <Droppable droppableId={"group-" + index} isDropDisabled={!isWindowDrag(dragType)}>
        {(provider, dropSnapshot) => (
          <WindowsContainer
            ref={provider.innerRef}
            {...provider.droppableProps}
            $searching={tabSearching}
            $searchingGroup={groupSearching}
            $draggedOver={dropSnapshot.isDraggingOver}
          >
            {hasMoreThanOneFilteredTab &&
              windows.map((window, i) => (
                <Draggable key={i} draggableId={`window-${i}-group-${index}`} index={i}>
                  {(provided, dragSnapshot) => (
                    <div ref={provided.innerRef} {...provided.draggableProps}>
                      <Window
                        {...window}
                        windowIndex={i}
                        snapshot={dragSnapshot}
                        dragHandleProps={provided.dragHandleProps}
                      />
                    </div>
                  )}
                </Draggable>
              ))}

            {provider.placeholder}
          </WindowsContainer>
        )}
      </Droppable>
    </div>
  );
}

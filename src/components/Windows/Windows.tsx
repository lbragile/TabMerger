import { useRef } from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { Scrollbar } from "../../styles/Scrollbar";
import Information from "./Information";
import SearchResult from "../SearchResult";
import Window from "./Window";
import { Draggable, Droppable } from "react-beautiful-dnd";
import { isWindowDrag } from "../../constants/dragRegExp";
import useContainerHeight from "../../hooks/useContainerHeight";

const WindowsContainer = styled(Scrollbar)<{ $height: number; $draggedOver: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  height: ${({ $height }) => $height + "px"};
  border: 1px dashed ${({ $draggedOver }) => ($draggedOver ? "blue" : "transparent")};
`;

export default function Windows(): JSX.Element {
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { filteredTabs } = useSelector((state) => state.filter);
  const {
    active: { index: groupIndex },
    available
  } = useSelector((state) => state.groups);
  const { dragType } = useSelector((state) => state.dnd);
  const { windows, updatedAt } = available[groupIndex];

  const hasMoreThanOneFilteredTab = !typing || filteredTabs.some((item) => item.length > 0);
  const tabSearching = typing && filterChoice === "tab";

  const windowContainerRef = useRef<HTMLDivElement | null>(null);
  const containerHeight = useContainerHeight(windowContainerRef, updatedAt, filterChoice, filteredTabs);

  return (
    <div>
      <Information />

      {tabSearching && <SearchResult type="tab" />}

      <div ref={windowContainerRef}>
        <Droppable droppableId={"group-" + groupIndex} isDropDisabled={!isWindowDrag(dragType)}>
          {(provider, dropSnapshot) => (
            <WindowsContainer
              ref={provider.innerRef}
              {...provider.droppableProps}
              $draggedOver={dropSnapshot.isDraggingOver}
              $height={containerHeight}
            >
              {hasMoreThanOneFilteredTab &&
                windows.map((window, i) => (
                  <Draggable key={i} draggableId={`window-${i}-group-${groupIndex}`} index={i}>
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
    </div>
  );
}

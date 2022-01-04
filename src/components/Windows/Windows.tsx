import { useRef } from "react";
import { Draggable, Droppable } from "react-beautiful-dnd";
import styled from "styled-components";

import Information from "./Information";
import Window from "./Window";

import SearchResult from "~/components/SearchResult";
import { isWindowDrag } from "~/constants/dragRegExp";
import useContainerHeight from "~/hooks/useContainerHeight";
import { useSelector } from "~/hooks/useRedux";
import { Scrollbar } from "~/styles/Scrollbar";

interface IWindowContainerStyle {
  $height: number;
  $draggedOver: boolean;
}

const WindowsContainer = styled(Scrollbar)<IWindowContainerStyle>`
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

  const windowContainerRef = useRef<HTMLDivElement | null>(null);
  const containerHeight = useContainerHeight(windowContainerRef, updatedAt, filterChoice, filteredTabs);

  const isTabSearch = filterChoice === "tab";

  return (
    <div>
      <Information />

      {typing && isTabSearch && <SearchResult />}

      <div ref={windowContainerRef}>
        <Droppable droppableId={"group-" + groupIndex} isDropDisabled={!isWindowDrag(dragType) || groupIndex === 0}>
          {(provider, dropSnapshot) => (
            <WindowsContainer
              ref={provider.innerRef}
              {...provider.droppableProps}
              $draggedOver={dropSnapshot.isDraggingOver}
              $height={containerHeight}
            >
              {windows.map(
                (window, i) =>
                  (!typing || !isTabSearch || filteredTabs[i]?.length > 0) && (
                    <Draggable
                      key={i}
                      draggableId={`window-${i}-group-${groupIndex}`}
                      index={i}
                      isDragDisabled={typing && isTabSearch}
                    >
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
                  )
              )}

              {provider.placeholder}
            </WindowsContainer>
          )}
        </Droppable>
      </div>
    </div>
  );
}

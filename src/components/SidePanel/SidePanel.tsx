import { useRef } from "react";
import { Draggable, Droppable } from "react-beautiful-dnd";
import styled, { css } from "styled-components";

import Group from "./Group";

import { isGroupDrag } from "~/constants/dragRegExp";
import useContainerHeight from "~/hooks/useContainerHeight";
import useFilter from "~/hooks/useFilter";
import { useSelector } from "~/hooks/useRedux";
import { Scrollbar } from "~/styles/Scrollbar";

const Column = css`
  display: flex;
  flex-direction: column;
  row-gap: 4.5px;
  align-items: start;
`;

const Container = styled.div`
  ${Column}
`;

const DraggableContainer = styled(Scrollbar)<{ $height: number; $dragging: boolean }>`
  ${Column};
  width: 210px;
  height: ${({ $height }) => $height + "px"};
  overflow-y: auto;
  overflow-x: hidden;
`;

export default function SidePanel(): JSX.Element {
  const { available } = useSelector((state) => state.groups.present);
  const { inputValue, filterChoice } = useSelector((state) => state.header);
  const { dragType, isDragging } = useSelector((state) => state.dnd);

  const { filteredGroups, nonEmptyGroups } = useFilter();
  const groupSearch = inputValue !== "" && filterChoice === "group";
  const tabSearch = inputValue !== "" && filterChoice === "tab";
  const currentGroups = groupSearch ? filteredGroups : tabSearch ? nonEmptyGroups : available;
  const groupDrag = isGroupDrag(dragType);

  const groupsContainerRef = useRef<HTMLDivElement | null>(null);
  const containerHeight = useContainerHeight(groupsContainerRef);

  return (
    <Container>
      {currentGroups.map((group) => group.id).includes(available[0].id) && <Group {...available[0]} />}

      <div ref={groupsContainerRef}>
        <Droppable droppableId="sidePanel" isCombineEnabled={!groupDrag}>
          {(provider) => (
            <DraggableContainer
              ref={provider.innerRef}
              {...provider.droppableProps}
              $height={containerHeight}
              $dragging={isDragging && groupDrag}
            >
              {currentGroups
                .filter((group) => group.id !== available[0].id)
                .map((data, i) => (
                  <Draggable
                    key={data.id + i + 1}
                    draggableId={`group-${i + 1}`}
                    index={i + 1}
                    isDragDisabled={groupSearch}
                  >
                    {(provided, dragSnapshot) => (
                      <div ref={provided.innerRef} {...provided.draggableProps}>
                        <Group {...data} snapshot={dragSnapshot} dragHandleProps={provided.dragHandleProps} />
                      </div>
                    )}
                  </Draggable>
                ))}

              {provider.placeholder}
            </DraggableContainer>
          )}
        </Droppable>
      </div>
    </Container>
  );
}

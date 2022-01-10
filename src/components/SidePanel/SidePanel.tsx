import { useRef } from "react";
import { Draggable, Droppable } from "react-beautiful-dnd";
import styled, { css } from "styled-components";

import Group from "./Group";

import { isGroupDrag } from "~/constants/dragRegExp";
import useContainerHeight from "~/hooks/useContainerHeight";
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
  const { available } = useSelector((state) => state.groups);
  const { filteredGroups } = useSelector((state) => state.filter);
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { dragType, isDragging } = useSelector((state) => state.dnd);
  const groupSearch = typing && filterChoice === "group";
  const groupDrag = isGroupDrag(dragType);

  const groupsContainerRef = useRef<HTMLDivElement | null>(null);
  const containerHeight = useContainerHeight(groupsContainerRef);

  return (
    <Container>
      {((groupSearch && filteredGroups.map((group) => group.id).includes(available[0].id)) || !groupSearch) && (
        <Group {...available[0]} />
      )}

      <div ref={groupsContainerRef}>
        <Droppable droppableId="sidePanel" isCombineEnabled={!groupDrag}>
          {(provider) => (
            <DraggableContainer
              ref={provider.innerRef}
              {...provider.droppableProps}
              $height={containerHeight}
              $dragging={isDragging && groupDrag}
            >
              {(groupSearch ? filteredGroups.filter((group) => group.id !== available[0].id) : available.slice(1)).map(
                (data, i) => (
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
                )
              )}

              {provider.placeholder}
            </DraggableContainer>
          )}
        </Droppable>
      </div>
    </Container>
  );
}

import React, { useEffect } from "react";
import styled from "styled-components";
import Group from "./Group";
import { useSelector } from "../../hooks/useSelector";
import GROUPS_CREATORS from "../../store/actions/groups";
import { useDispatch } from "../../hooks/useDispatch";
import { Scrollbar } from "../../styles/Scrollbar";
import { Draggable, Droppable } from "react-beautiful-dnd";
import { isGroupDrag } from "../../constants/dragRegExp";

const GroupsContainer = styled(Scrollbar)<{ $searching: boolean; $canDrop: boolean; $dragging: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  row-gap: 4px;
  height: ${({ $searching }) => ($searching ? "472px" : "528px")};
  background-color: ${({ $canDrop, $dragging }) =>
    $canDrop ? "#d5ffd5" : !$canDrop && $dragging ? "#ffd3d3" : "initial"};
  overflow-y: auto;
  overflow-x: hidden;
`;

export default function SidePanel(): JSX.Element {
  const dispatch = useDispatch();

  const { available } = useSelector((state) => state.groups);
  const { filteredGroups } = useSelector((state) => state.filter);
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { dragType, isDragging, canDrop } = useSelector((state) => state.dnd);
  const groupSearch = typing && filterChoice === "group";
  const groupDrag = isGroupDrag(dragType);

  /**
   * update each group's information if it doesn't match the current ...
   * ... whenever the list of groups updates
   */
  useEffect(() => {
    available.forEach((group, i) => {
      const { windows: allWindows, info } = group;
      const countArr = allWindows.map((currentWindow) => currentWindow.tabs?.length ?? 0);
      const total = countArr.reduce((total, val) => total + val, 0);
      const newInfo = `${total}T | ${allWindows.length}W`;
      if (info !== newInfo) {
        dispatch(GROUPS_CREATORS.updateInfo({ index: i, info: newInfo }));
      }
    });
  }, [dispatch, available]);

  return (
    <div>
      <Droppable droppableId="sidePanel" isCombineEnabled={!groupDrag}>
        {(provider, dropSnapshot) => (
          <GroupsContainer
            ref={provider.innerRef}
            {...provider.droppableProps}
            $searching={groupSearch}
            $canDrop={dropSnapshot.isDraggingOver && canDrop && groupDrag}
            $dragging={isDragging && groupDrag}
          >
            {(groupSearch ? filteredGroups : available).map((data, i) => (
              <Draggable key={data.id + i} draggableId={`group-${i}`} index={i} isDragDisabled={i <= 1}>
                {(provided, dragSnapshot) => (
                  <div ref={provided.innerRef} {...provided.draggableProps}>
                    <Group data={data} snapshot={dragSnapshot} dragHandleProps={provided.dragHandleProps} />
                  </div>
                )}
              </Draggable>
            ))}

            {provider.placeholder}
          </GroupsContainer>
        )}
      </Droppable>
    </div>
  );
}

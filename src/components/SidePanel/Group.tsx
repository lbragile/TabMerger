import React, { useState } from "react";
import styled, { css } from "styled-components";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { useDispatch } from "../../hooks/useDispatch";
import GROUPS_CREATORS from "../../store/actions/groups";
import { IGroupsState } from "../../store/reducers/groups";
import { relativeTimeStr } from "../../utils/helper";
import { useSelector } from "../../hooks/useSelector";
import Highlighted from "../Highlighted";
import { DraggableProvidedDragHandleProps, DraggableStateSnapshot } from "react-beautiful-dnd";
import DND_CREATORS from "../../store/actions/dnd";
import { isGroupDrag } from "../../constants/dragRegExp";
import { CloseIcon } from "../../styles/CloseIcon";

interface IGroupStyle {
  active: boolean;
  color: string;
  $overflow: boolean;
  $dragging: boolean;
  $draggingOver: boolean;
  $draggingGlobal: boolean;
}

const Container = styled.div`
  position: relative;
`;

const AbsoluteCloseIcon = styled(CloseIcon)`
  position: absolute;
  top: 4px;
  right: 4px;
`;

const StyledDiv = styled.div<IGroupStyle>`
  ${({ $overflow: overflow }) => css`
    width: ${overflow ? "195px" : "209px"};
    margin-right: ${overflow ? "4px" : "0"};
  `}
  height: 49px;
  border-radius: 4px;
  background-color: ${({ active, $dragging, $draggingOver }) =>
    active ? "#BEDDF4" : $dragging ? "lightgrey" : $draggingOver ? "#caffca" : "white"};
  border: 1px solid ${({ color }) => color};
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 4px 8px 4px 16px;
  cursor: ${({ $draggingOver, $draggingGlobal }) => ($draggingOver || $draggingGlobal ? "grabbing" : "pointer")};
  ${({ $draggingGlobal }) =>
    !$draggingGlobal &&
    css`
      &:hover ${AbsoluteCloseIcon} {
        color: rgba(0, 0, 0, 0.3);
        display: block;

        &:hover {
          color: rgba(255, 0, 0, 0.6);
        }
      }
    `}
`;

const Headline = styled.div`
  font-size: 16px;
  font-weight: 600;
  width: 95%;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
`;

const Information = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
`;

const ColorIndicator = styled.div<{ color: string }>`
  width: 8px;
  height: 100%;
  background-color: ${({ color }) => color};
  position: absolute;
  top: 0;
  left: 0;
`;

interface IGroup {
  data: IGroupsState["available"][number];
  available: IGroupsState["available"];
  overflow: boolean;
}

export default function Group({
  data,
  available,
  overflow,
  snapshot,
  dragHandleProps
}: IGroup & {
  snapshot: DraggableStateSnapshot;
  dragHandleProps: DraggableProvidedDragHandleProps | undefined;
}): JSX.Element {
  const dispatch = useDispatch();
  const { filterChoice } = useSelector((state) => state.header);
  const { isDragging, dragType, dragOverGroup } = useSelector((state) => state.dnd);
  const { active } = useSelector((state) => state.groups);

  const { name, id, color, updatedAt, permanent, info } = data;
  const index = available.findIndex((group) => group.id === id);
  const groupDrag = isGroupDrag(dragType);
  const isActive = active.index === index;

  const [draggingOver, setDraggingOver] = useState(false);

  const handleActiveGroupUpdate = () => !isActive && dispatch(GROUPS_CREATORS.updateActive({ index, id }));

  const handleGroupDragOver = (eventType: "enter" | "leave") => {
    const isEntering = eventType === "enter";
    if (isDragging && !groupDrag) {
      setDraggingOver(isEntering);
      if ((isEntering ? index : dragOverGroup) > 1) {
        dispatch(DND_CREATORS.updateDragOverGroup(isEntering ? index : 0));
      }
    }
  };

  const handleShowTitleOverflow = (
    { currentTarget }: React.PointerEvent<HTMLDivElement>,
    eventType: "enter" | "leave"
  ) => {
    if (!isDragging && currentTarget && currentTarget.scrollWidth > currentTarget.clientWidth) {
      const { right, top, height } = currentTarget.getBoundingClientRect();
      dispatch(
        GROUPS_CREATORS.updateOverflowTitlePopup({
          visible: eventType === "enter",
          text: name,
          pos: { x: right + 2, y: top - height / 2 }
        })
      );
    }
  };

  return (
    <Container>
      <StyledDiv
        tabIndex={0}
        role="button"
        color={color}
        active={isActive}
        $overflow={overflow}
        $dragging={snapshot.isDragging}
        $draggingOver={index > 1 && isDragging && !groupDrag && draggingOver}
        $draggingGlobal={isDragging}
        onClick={handleActiveGroupUpdate}
        onKeyPress={() => console.log("key press")}
        onPointerEnter={() => handleGroupDragOver("enter")}
        onPointerUp={() => isDragging && setDraggingOver(false)} // drop does not call 'leave' - draggingOver local state isn't reset
        onPointerLeave={() => handleGroupDragOver("leave")}
      >
        <Headline
          onPointerEnter={(e) => handleShowTitleOverflow(e, "enter")}
          onPointerLeave={(e) => handleShowTitleOverflow(e, "leave")}
          onFocus={() => console.log("focused")}
          {...dragHandleProps}
        >
          {filterChoice === "group" ? <Highlighted text={name} /> : name}
        </Headline>

        <Information>
          <span>{info ?? "0T | 0W"}</span> <span>{relativeTimeStr(updatedAt)}</span>
        </Information>

        <ColorIndicator
          color={color}
          role="button"
          tabIndex={0}
          onClick={() => console.log("open color picker")}
          onKeyPress={() => console.log("keyPress")}
        />

        {!permanent && (
          <AbsoluteCloseIcon
            icon={faTimes}
            onClick={(e) => {
              e.stopPropagation();
              dispatch(GROUPS_CREATORS.deleteGroup({ index, id }));
            }}
          />
        )}
      </StyledDiv>
    </Container>
  );
}

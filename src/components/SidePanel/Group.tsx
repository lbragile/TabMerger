import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import type { DraggableProvidedDragHandleProps, DraggableStateSnapshot } from "react-beautiful-dnd";
import type { IGroupItemState } from "~/store/reducers/groups";

import ColorPicker from "~/components/ColorPicker";
import Highlighted from "~/components/Highlighted";
import Popup from "~/components/Popup";
import { isGroupDrag } from "~/constants/dragRegExp";
import useClickOutside from "~/hooks/useClickOutside";
import { useDebounce } from "~/hooks/useDebounce";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { updateColor, deleteGroup, updateActive } from "~/store/actions/groups";
import { setShowUndo } from "~/store/actions/header";
import {
  AbsoluteCloseIcon,
  ColorIndicator,
  GroupButton,
  GroupButtonContainer,
  GroupHeadline,
  GroupInformation
} from "~/styles/Group";
import { relativeTimeStr } from "~/utils/helper";

interface IGroupStyle {
  $permanent: boolean;
  $isActive: boolean;
  $overflow: boolean;
  $dragging: boolean;
  $draggingOver: boolean;
  $draggingGlobal: boolean;
}

const StyledGroupButton = styled(GroupButton)<IGroupStyle>`
  ${({ $overflow: overflow }) => css`
    width: ${overflow ? "197px" : "209px"};
    margin-right: ${overflow ? "4px" : "0"};
  `}
  background-color: ${({ $isActive, $dragging, $draggingOver, theme }) =>
    $isActive ? "#beddf4" : $dragging ? "lightgrey" : $draggingOver ? "#cfc" : theme.colors.surface};
  color: ${({ $isActive, $dragging, $draggingOver, theme }) =>
    $isActive || $dragging || $draggingOver ? "black" : theme.colors.onSurface};
  outline: 1px solid
    ${({ $permanent, theme }) => ($permanent ? "rgb(133 66 0 / 30%)" : theme.colors.onBackground + "2")};
  cursor: ${({ $draggingOver, $draggingGlobal }) => ($draggingOver || $draggingGlobal ? "grabbing" : "pointer")};
`;

const StyledGroupHeadline = styled(GroupHeadline).attrs(() => ({ as: "div" }))<{
  $isActive: boolean;
  $isFirst: boolean;
}>`
  transition: background-color 0.3s ease, padding 0.3s ease;

  &:hover {
    border-bottom: none;
  }

  ${({ $isFirst, $isActive }) =>
    !$isFirst &&
    css`
      &:hover {
        padding: 0 4px;
        background-color: ${$isActive ? "#ffffffb7" : "#dfdfdfb7"};
      }
    `}
`;

const ColorPickerContainer = styled.div<{ $pos: { right: number; top: number }; $visible: boolean }>`
  position: fixed;
  z-index: 2;
  display: ${({ $visible }) => ($visible ? "flex" : "none")};
  ${({ $pos: { right, top } }) => css`
    top: ${top}px;
    left: ${right + 12}px;
  `}
`;

interface IGroup {
  snapshot?: DraggableStateSnapshot;
  dragHandleProps?: DraggableProvidedDragHandleProps;
}

export default function Group({
  name,
  id,
  color,
  updatedAt,
  permanent,
  info,
  snapshot,
  dragHandleProps
}: IGroupItemState & IGroup): JSX.Element {
  const dispatch = useDispatch();

  const { filterChoice } = useSelector((state) => state.header);
  const { isDragging, dragType } = useSelector((state) => state.dnd);
  const { active, available } = useSelector((state) => state.groups.present);

  const index = available.findIndex((group) => group.id === id);
  const groupDrag = isGroupDrag(dragType);
  const isActive = active.index === index;

  const groupRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [draggingOver, setDraggingOver] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ right: number; top: number }>({ right: 0, top: 0 });
  const [colorPickerValue, setColorPickerValue] = useState(color);
  const [titleOverflow, setTitleOverflow] = useState({ visible: false, text: "", pos: { x: 0, y: 0 } });
  const debouncedPickerValue = useDebounce(colorPickerValue, 100);

  useClickOutside<HTMLDivElement>({
    ref: pickerRef,
    preCondition: showPicker,
    cb: () => {
      dispatch(updateColor({ index, color: debouncedPickerValue }));
      setShowPicker(false);
    }
  });

  // When importing, the color picker value needs to update
  useEffect(() => setColorPickerValue(color), [color]);

  const handleActiveGroupUpdate = () => !isActive && dispatch(updateActive({ index, id }));

  const handleShowTitleOverflow = (
    { currentTarget }: React.PointerEvent<HTMLDivElement>,
    eventType: "enter" | "leave"
  ) => {
    if (!isDragging && currentTarget && currentTarget.scrollWidth > currentTarget.clientWidth) {
      const { right, top } = currentTarget.getBoundingClientRect();
      setTitleOverflow({ visible: eventType === "enter", text: name, pos: { x: right, y: top - 2 } });
    }
  };

  const handleShowPicker = (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();

    // Groups below the half way mark will have their color pickers show upwards.
    // Timeout allows the picker to be displayed so that it's height can be captured
    setTimeout(() => {
      if (pickerRef.current && groupRef.current) {
        setShowPicker(true);
        const { right, top, height: heightGroup } = groupRef.current.getBoundingClientRect();
        const { height: heightPicker } = pickerRef.current.getBoundingClientRect();
        setPickerPos({ right, top: top >= 300 ? top - (heightPicker - heightGroup) : top });
      }
    }, 0);
  };

  const handleCloseGroup = () => {
    dispatch(deleteGroup({ index }));
    dispatch(setShowUndo(true));
  };

  return (
    <>
      <GroupButtonContainer ref={groupRef}>
        <StyledGroupButton
          tabIndex={0}
          role="button"
          $permanent={index === 0}
          $isActive={isActive}
          $overflow={available.length > 10}
          $dragging={!!snapshot?.isDragging}
          $draggingOver={index > 0 && isDragging && !groupDrag && draggingOver}
          $draggingGlobal={isDragging}
          onClick={handleActiveGroupUpdate}
          onKeyPress={({ code }) => code === "Enter" && handleActiveGroupUpdate()}
          onPointerEnter={() => setDraggingOver(true)}
          onPointerLeave={() => setDraggingOver(false)}
        >
          <ColorIndicator
            color={debouncedPickerValue}
            role="button"
            tabIndex={0}
            onClick={handleShowPicker}
            onKeyPress={(e) => e.key === "Enter" && handleShowPicker(e)}
          />

          <StyledGroupHeadline
            $isActive={isActive}
            $isFirst={index === 0}
            onPointerEnter={(e) => handleShowTitleOverflow(e, "enter")}
            onPointerLeave={(e) => handleShowTitleOverflow(e, "leave")}
            {...dragHandleProps}
          >
            {filterChoice === "group" ? <Highlighted text={name} /> : name}
          </StyledGroupHeadline>

          <GroupInformation>
            <span>{info ?? "0T | 0W"}</span> <span>{relativeTimeStr(updatedAt)}</span>
          </GroupInformation>

          {!permanent && !isDragging && (
            <AbsoluteCloseIcon
              tabIndex={0}
              icon="times"
              onClick={(e) => {
                e.stopPropagation();
                handleCloseGroup();
              }}
              onPointerDown={(e) => e.preventDefault()}
              onKeyPress={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  handleCloseGroup();
                }
              }}
            />
          )}
        </StyledGroupButton>
      </GroupButtonContainer>

      {/* Want this to be present in the DOM since it's height is used to calculate position */}
      <ColorPickerContainer ref={pickerRef} $pos={pickerPos} $visible={showPicker}>
        <ColorPicker color={debouncedPickerValue} setColor={setColorPickerValue} />
      </ColorPickerContainer>

      {titleOverflow.visible && <Popup {...titleOverflow} />}
    </>
  );
}

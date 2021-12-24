import { useRef, useState } from "react";
import styled, { css } from "styled-components";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { useDispatch, useSelector } from "../../hooks/useRedux";
import GROUPS_CREATORS from "../../store/actions/groups";
import { IGroupsState } from "../../store/reducers/groups";
import { relativeTimeStr } from "../../utils/helper";
import Highlighted from "../Highlighted";
import { DraggableProvidedDragHandleProps, DraggableStateSnapshot } from "react-beautiful-dnd";
import { isGroupDrag } from "../../constants/dragRegExp";
import { CloseIcon } from "../../styles/CloseIcon";
import { ColorPicker } from "@mantine/core";
import useDebounce from "../../hooks/useDebounce";
import useClickOutside from "../../hooks/useClickOutside";
import { COLOR_PICKER_SWATCHES } from "../../constants/colorPicker";
import Popup from "../Popup";

interface IGroupStyle {
  active: boolean;
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

const GroupButton = styled.div<IGroupStyle>`
  ${({ $overflow: overflow }) => css`
    width: ${overflow ? "197px" : "209px"};
    margin-right: ${overflow ? "4px" : "0"};
  `}
  height: 49px;
  background-color: ${({ active, $dragging, $draggingOver }) =>
    active ? "#BEDDF4" : $dragging ? "lightgrey" : $draggingOver ? "#caffca" : "white"};
  border: 1px solid rgba(0, 0, 0, 0.1);
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 2px 8px 2px 16px;
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
  transition: transform 0.3s linear, background-color 0.3s ease-out;

  &:hover {
    transform: scaleX(2);
  }
`;

const ColorPickerContainer = styled.div<{ $pos: { right: number; top: number }; $visible: boolean }>`
  box-shadow: 0 0 4px 0 black;
  padding: 4px;
  border-radius: 4px;
  position: fixed;
  background: white;
  z-index: 10;
  display: ${({ $visible }) => ($visible ? "flex" : "none")};
  flex-direction: column;
  align-items: center;
  gap: 8px;
  ${({ $pos: { right, top } }) => css`
    top: ${top}px;
    left: ${right + 12}px;
  `}

  & .mantine-ColorPicker-thumb,
  & .mantine-ColorPicker-saturation,
  & .mantine-ColorPicker-slider {
    cursor: crosshair;
  }

  & > span {
    font-size: 14px;
    margin-bottom: 4px;
  }
`;

interface IGroup {
  data: IGroupsState["available"][number];
  snapshot: DraggableStateSnapshot;
  dragHandleProps: DraggableProvidedDragHandleProps | undefined;
}

export default function Group({ data, snapshot, dragHandleProps }: IGroup): JSX.Element {
  const dispatch = useDispatch();
  const { filterChoice } = useSelector((state) => state.header);
  const { isDragging, dragType } = useSelector((state) => state.dnd);
  const { active, available } = useSelector((state) => state.groups);

  const { name, id, color, updatedAt, permanent, info } = data;
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
      dispatch(GROUPS_CREATORS.updateColor({ index, color: debouncedPickerValue }));
      setShowPicker(false);
    }
  });

  const handleActiveGroupUpdate = () => !isActive && dispatch(GROUPS_CREATORS.updateActive({ index, id }));

  const handleShowTitleOverflow = (
    { currentTarget }: React.PointerEvent<HTMLDivElement>,
    eventType: "enter" | "leave"
  ) => {
    if (!isDragging && currentTarget && currentTarget.scrollWidth > currentTarget.clientWidth) {
      const { right, top, height } = currentTarget.getBoundingClientRect();
      setTitleOverflow({
        visible: eventType === "enter",
        text: name,
        pos: { x: right + 2, y: top - height / 4 }
      });
    }
  };

  return (
    <>
      <Container ref={groupRef}>
        <GroupButton
          tabIndex={0}
          role="button"
          active={isActive}
          $overflow={available.length > 10}
          $dragging={snapshot.isDragging}
          $draggingOver={index > 0 && isDragging && !groupDrag && draggingOver}
          $draggingGlobal={isDragging}
          onClick={handleActiveGroupUpdate}
          onKeyPress={() => console.log("key press")}
          onPointerEnter={() => setDraggingOver(true)}
          onPointerLeave={() => setDraggingOver(false)}
        >
          <Headline
            onPointerEnter={(e) => handleShowTitleOverflow(e, "enter")}
            onPointerLeave={(e) => handleShowTitleOverflow(e, "leave")}
            {...dragHandleProps}
          >
            {filterChoice === "group" ? <Highlighted text={name} /> : name}
          </Headline>

          <Information>
            <span>{info ?? "0T | 0W"}</span> <span>{relativeTimeStr(updatedAt)}</span>
          </Information>

          <ColorIndicator
            color={debouncedPickerValue}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();

              // groups below the half way mark will have their color pickers show upwards.
              // timeout allows the picker to be displayed so that it's height can be captured
              setTimeout(() => {
                if (pickerRef.current && groupRef.current) {
                  setShowPicker(true);
                  const { right, top, height: heightGroup } = groupRef.current.getBoundingClientRect();
                  const { height: heightPicker } = pickerRef.current.getBoundingClientRect();
                  setPickerPos({ right, top: top >= 300 ? top - (heightPicker - heightGroup) : top });
                }
              }, 0);
            }}
            onKeyPress={() => console.log("keyPress")}
          />

          {!permanent && !isDragging && (
            <AbsoluteCloseIcon
              tabIndex={0}
              icon={faTimes}
              onClick={(e) => {
                e.stopPropagation();
                dispatch(GROUPS_CREATORS.deleteGroup(index));
              }}
              onKeyPress={(e) => {
                e.stopPropagation();
                e.key === "Enter" && dispatch(GROUPS_CREATORS.deleteGroup(index));
              }}
            />
          )}
        </GroupButton>
      </Container>

      {/* Want this to be present in the DOM since it's height is used to calculate position */}
      <ColorPickerContainer ref={pickerRef} $pos={pickerPos} $visible={showPicker}>
        <ColorPicker
          format="rgba"
          value={debouncedPickerValue}
          onChange={setColorPickerValue}
          swatches={COLOR_PICKER_SWATCHES}
        />
        <span>{debouncedPickerValue}</span>
      </ColorPickerContainer>

      {titleOverflow.visible && <Popup {...titleOverflow} />}
    </>
  );
}

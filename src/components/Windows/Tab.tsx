import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import Highlighted from "../Highlighted";
import { DraggableProvidedDragHandleProps, DraggableStateSnapshot } from "react-beautiful-dnd";
import { isTabDrag } from "../../constants/dragRegExp";
import { CloseIcon } from "../../styles/CloseIcon";
import { useDispatch } from "../../hooks/useDispatch";
import GROUPS_CREATORS from "../../store/actions/groups";

const TabContainer = styled.div<{ $dragging: boolean }>`
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  justify-content: start;
  gap: 8px;
  background-color: ${({ $dragging }) => ($dragging ? "white" : "initial")};
  border: 1px dashed ${({ $dragging }) => ($dragging ? "grey" : "initial")};
  border-radius: 4px;
`;

const TabTitle = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

const TabIcon = styled.img`
  height: 14px;
  width: 14px;
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

export default function Tab({
  favIconUrl,
  title,
  url,
  active,
  pinned,
  id: tabId,
  snapshot,
  dragHandleProps,
  tabIndex,
  windowIndex
}: chrome.tabs.Tab & {
  tabIndex: number;
  windowIndex: number;
  snapshot: DraggableStateSnapshot;
  dragHandleProps: DraggableProvidedDragHandleProps | undefined;
}): JSX.Element {
  const dispatch = useDispatch();

  const {
    active: { index: groupIndex }
  } = useSelector((state) => state.groups);
  const { filterChoice } = useSelector((state) => state.header);
  const { isDragging, dragType } = useSelector((state) => state.dnd);

  const openTab = () => chrome.tabs.create({ url, active, pinned });
  const closeTab = () => {
    if (groupIndex > 1) {
      dispatch(GROUPS_CREATORS.closeTab({ tabIndex, windowIndex, groupIndex }));

      //  possible to have deleted the last tab in the window
      dispatch(GROUPS_CREATORS.clearEmptyWindows({ index: groupIndex }));
    } else {
      tabId && chrome.tabs.remove(tabId);
    }
  };

  return (
    <Row>
      <CloseIcon
        icon={faTimes}
        tabIndex={0}
        onClick={closeTab}
        onKeyPress={({ key }) => key === "Enter" && closeTab()}
        $visible={!isDragging}
      />

      <TabContainer $dragging={snapshot.isDragging && isTabDrag(dragType)}>
        <TabIcon
          src={
            favIconUrl === "" || !favIconUrl
              ? "https://developer.chrome.com/images/meta/favicon-32x32.png"
              : favIconUrl?.replace("-dark", "")
          }
          alt="Favicon"
          {...dragHandleProps}
        />

        <TabTitle
          title={url}
          role="link"
          tabIndex={0}
          onClick={openTab}
          onKeyPress={({ key }) => key === "Enter" && openTab()}
        >
          {filterChoice === "tab" ? <Highlighted text={title} /> : title}
        </TabTitle>
      </TabContainer>
    </Row>
  );
}

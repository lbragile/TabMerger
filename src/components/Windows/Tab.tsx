import React from "react";
import styled, { css } from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Highlighted from "../Highlighted";
import { DraggableProvidedDragHandleProps, DraggableStateSnapshot } from "react-beautiful-dnd";
import { isTabDrag } from "../../constants/dragRegExp";

const TabContainer = styled.div<{ $dragging: boolean }>`
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  justify-content: start;
  gap: 8px;
  width: 320px;
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

const CloseIcon = styled(FontAwesomeIcon)<{ $visible: boolean }>`
  && {
    ${({ $visible }) =>
      $visible
        ? css`
            cursor: pointer;
            color: transparent;

            &:hover {
              color: #ff4040;
            }
          `
        : css`
            visibility: hidden;
          `}
  }
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
  dragHandleProps
}: chrome.tabs.Tab & {
  snapshot: DraggableStateSnapshot;
  dragHandleProps: DraggableProvidedDragHandleProps | undefined;
}): JSX.Element {
  const { filterChoice } = useSelector((state) => state.header);
  const { isDragging, dragType } = useSelector((state) => state.dnd);

  const openTab = () => chrome.tabs.create({ url, active, pinned });
  const closeTab = () => tabId && chrome.tabs.remove(tabId);

  return (
    <Row>
      <CloseIcon
        icon={faTimesCircle}
        tabIndex={0}
        onClick={() => closeTab()}
        onKeyPress={(e) => e.key === "Enter" && closeTab()}
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
          onClick={() => openTab()}
          onKeyPress={(e) => e.key === "Enter" && openTab()}
        >
          {filterChoice === "tab" ? <Highlighted text={title} /> : title}
        </TabTitle>
      </TabContainer>
    </Row>
  );
}

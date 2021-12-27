import { DraggableProvidedDragHandleProps, DraggableStateSnapshot } from "react-beautiful-dnd";
import styled, { css } from "styled-components";

import { isTabDrag } from "../../constants/dragRegExp";
import { useDispatch, useSelector } from "../../hooks/useRedux";
import GROUPS_CREATORS from "../../store/actions/groups";
import { CloseIcon } from "../../styles/CloseIcon";
import Highlighted from "../Highlighted";

const TabContainer = styled.div<{ $dragging: boolean }>`
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  justify-content: start;
  gap: 8px;
  padding: 0 2px;
  background-color: ${({ $dragging }) => ($dragging ? "white" : "initial")};
  border: 1px dashed ${({ $dragging }) => ($dragging ? "grey" : "initial")};
`;

const TabTitle = styled.a`
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: black;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

const TabIcon = styled.img<{ $darken?: boolean }>`
  height: 14px;
  width: 14px;
  transition: transform 0.3s ease;
  ${({ $darken }) =>
    $darken &&
    css`
      filter: brightness(10%);
    `}

  &:hover,
  &:focus-visible {
    transform: scale(1.25);
  }
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

interface ITab {
  tabIndex: number;
  windowIndex: number;
  snapshot: DraggableStateSnapshot;
  dragHandleProps: DraggableProvidedDragHandleProps | undefined;
}

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
}: chrome.tabs.Tab & ITab): JSX.Element {
  const dispatch = useDispatch();

  const {
    available,
    active: { index: groupIndex }
  } = useSelector((state) => state.groups);
  const { filterChoice } = useSelector((state) => state.header);
  const { isDragging, dragType } = useSelector((state) => state.dnd);

  const openTab = () => chrome.tabs.create({ url, active, pinned });

  const closeTab = () => {
    if (groupIndex > 0) {
      dispatch(GROUPS_CREATORS.closeTab({ tabIndex, windowIndex, groupIndex }));

      // possible to have deleted the last tab in the window and/or group
      if (!available[groupIndex].windows[windowIndex].tabs?.length) {
        dispatch(GROUPS_CREATORS.deleteWindow({ groupIndex, windowIndex }));
      }

      if (!available[groupIndex].windows.length) {
        dispatch(GROUPS_CREATORS.deleteGroup(groupIndex));
      }
    } else {
      tabId && chrome.tabs.remove(tabId);
    }
  };

  return (
    <Row>
      <CloseIcon
        icon="times"
        tabIndex={0}
        onClick={closeTab}
        onPointerDown={(e) => e.preventDefault()}
        onKeyPress={({ key }) => key === "Enter" && closeTab()}
        $visible={!isDragging}
      />

      <TabContainer $dragging={snapshot.isDragging && isTabDrag(dragType)}>
        <TabIcon
          $darken={url?.includes("github.com")}
          src={!favIconUrl ? "https://developer.chrome.com/images/meta/favicon-32x32.png" : favIconUrl}
          alt="Favicon"
          {...dragHandleProps}
        />

        <TabTitle title={url} href={url} onClick={(e) => e.button === 0 && openTab()} draggable={false}>
          {filterChoice === "tab" ? <Highlighted text={title} /> : title}
        </TabTitle>
      </TabContainer>
    </Row>
  );
}

import styled, { css } from "styled-components";

import type { DraggableProvidedDragHandleProps, DraggableStateSnapshot } from "react-beautiful-dnd";

import Highlighted from "~/components/Highlighted";
import { isTabDrag } from "~/constants/dragRegExp";
import { DEFAULT_FAVICON_URL } from "~/constants/urls";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { deleteTab, deleteWindow, deleteGroup } from "~/store/actions/groups";
import { CloseIcon } from "~/styles/CloseIcon";
import { Row } from "~/styles/Row";
import { generateFavIconFromUrl } from "~/utils/helper";

const TabContainer = styled.div<{ $dragging: boolean }>`
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  justify-content: start;
  gap: 8px;
  padding: 0 2px;
  background-color: ${({ $dragging, theme }) => ($dragging ? theme.colors.background : "transparent")};
  border: 1px dashed ${({ $dragging }) => ($dragging ? "grey" : "transparent")};
`;

const TabTitle = styled.a<{ $isDragging: boolean }>`
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${({ theme }) => theme.colors.onBackground};
  cursor: ${({ $isDragging }) => ($isDragging ? "grabbing" : "pointer")};
  ${({ $isDragging }) =>
    !$isDragging &&
    css`
      &:hover {
        text-decoration: underline;
      }
    `}
`;

const TabIcon = styled.img`
  height: 14px;
  width: 14px;
  transition: transform 0.3s ease;

  &:hover,
  &:focus-visible {
    transform: scale(1.25);
  }
`;

interface ITab {
  tabIndex: number;
  windowIndex: number;
  italicizeNonHttp: boolean;
  snapshot: DraggableStateSnapshot;
  dragHandleProps: DraggableProvidedDragHandleProps | undefined;
}

export default function Tab({
  title,
  url,
  active,
  pinned,
  id: tabId,
  italicizeNonHttp,
  snapshot,
  dragHandleProps,
  tabIndex,
  windowId,
  windowIndex
}: chrome.tabs.Tab & ITab): JSX.Element {
  const dispatchWithHistory = useDispatch(true);

  const { available, active: activeGroup } = useSelector((state) => state.groups);

  const { index: groupIndex } = activeGroup;

  const { filterChoice } = useSelector((state) => state.header);
  const { isDragging, dragType } = useSelector((state) => state.dnd);

  const openTab = () =>
    groupIndex === 0
      ? chrome.windows.update(windowId, { focused: true }, () =>
          chrome.tabs.update(tabId ?? 0, { active: true }, () => "")
        )
      : chrome.tabs.create({ url, active, pinned, windowId }, () => "");

  const closeTab = () => {
    if (groupIndex > 0) {
      const { windows } = available[groupIndex];
      const numTabsInWindow = windows[windowIndex].tabs?.length;

      // Possible to have deleted the last tab in the window and/or group
      const isLastWindow = numTabsInWindow === 1;
      const isLastTab = windows.length === 1 && isLastWindow;

      if (isLastTab) {
        dispatchWithHistory(deleteGroup({ index: groupIndex, active: activeGroup }));
      } else if (isLastWindow) {
        dispatchWithHistory(deleteWindow({ groupIndex, windowIndex }));
      } else {
        dispatchWithHistory(deleteTab({ tabIndex, windowIndex, groupIndex }));
      }
    } else {
      tabId && chrome.tabs.remove(tabId, () => "");
    }
  };

  const tabTitle = filterChoice === "tab" ? <Highlighted text={title} /> : title;

  return (
    <Row $gap="4px">
      <CloseIcon
        icon="times"
        tabIndex={0}
        onClick={closeTab}
        onPointerDown={(e) => e.preventDefault()}
        onKeyPress={({ key }) => key === "Enter" && closeTab()}
      />

      <TabContainer $dragging={snapshot.isDragging && isTabDrag(dragType)}>
        <TabIcon
          src={generateFavIconFromUrl(url)}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = DEFAULT_FAVICON_URL;
          }}
          alt="Favicon"
          {...dragHandleProps}
        />

        <TabTitle
          $isDragging={isDragging}
          title={url}
          href={url}
          onClick={(e) => e.button === 0 && openTab()}
          draggable={false}
        >
          {italicizeNonHttp && !/^https?/.test(url ?? "") ? <i>{tabTitle}</i> : tabTitle}
        </TabTitle>
      </TabContainer>
    </Row>
  );
}

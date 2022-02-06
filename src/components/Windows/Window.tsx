import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useMemo, useRef, useState } from "react";
import { Draggable, Droppable } from "react-beautiful-dnd";
import styled, { css } from "styled-components";

import Tab from "./Tab";

import type { DraggableProvidedDragHandleProps, DraggableStateSnapshot } from "react-beautiful-dnd";

import Dropdown from "~/components/Dropdown";
import Popup from "~/components/Popup";
import { isTabDrag } from "~/constants/dragRegExp";
import { GOOGLE_HOMEPAGE } from "~/constants/urls";
import useClickOutside from "~/hooks/useClickOutside";
import useFilter from "~/hooks/useFilter";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import useRename from "~/hooks/useRename";
import {
  deleteWindow,
  deleteGroup,
  toggleWindowStarred,
  toggleWindowIncognito,
  updateWindowName
} from "~/store/actions/groups";
import { CloseIcon } from "~/styles/CloseIcon";
import { Column } from "~/styles/Column";
import { Row } from "~/styles/Row";
import { TabCounter, WindowHeadline, WindowTitle } from "~/styles/Window";
import { pluralize } from "~/utils/helper";

const WindowContainer = styled(Column)<{ $dragging: boolean }>`
  justify-content: center;
  font-size: 14px;
  padding: 0 ${({ $dragging }) => ($dragging ? "4px" : "0")};
`;

const StyledWindowTitle = styled(WindowTitle)<{ $active: boolean; $open: boolean; $dragging: boolean }>`
  background-color: ${({ $open, $active }) => ($open ? ($active ? "#dde8ffb7" : "#dfdfdfb7") : "transparent")};
  ${({ $dragging, $active }) =>
    $dragging
      ? css`
          use-event: none;
          cursor: grabbing;
        `
      : css`
          &:hover,
          &:focus-visible {
            background-color: ${$active ? "#dde8ffb7" : "#dfdfdfb7"};
          }
        `}
`;

const Headline = styled(WindowHeadline)<{ $active: boolean; $dragging: boolean }>`
  background-color: ${({ $dragging, theme }) => ($dragging ? theme.colors.surface : "transparent")};
  border: 1px dashed ${({ $dragging }) => ($dragging ? "grey" : "initial")};

  & svg,
  & ${StyledWindowTitle} {
    color: ${({ $active, theme }) => ($active ? theme.colors.primary : theme.colors.onBackground)};
  }
`;

const TabsContainer = styled(Column)<{ $draggedOver: boolean; $dragOrigin: boolean }>`
  margin-left: 24px;
  border: 1px dashed ${({ $draggedOver, theme }) => ($draggedOver ? theme.colors.primary : "transparent")};
  background-color: ${({ $dragOrigin, theme }) => ($dragOrigin ? theme.colors.surface : "transparent")};
`;

const TitleContainer = styled.div`
  position: relative;
`;

const IconStack = styled.div`
  position: relative;
  transition: transform 0.3s ease;

  & svg:nth-child(2) {
    font-size: 7px;
    position: absolute;
    top: 0;
    right: -3.5px;
    color: #ff8000;
  }
`;

type TOpenWindow = "new" | "current" | "incognito" | "focus";

interface IWindow {
  windowIndex: number;
  starred?: boolean;
  name?: string;
  snapshot: DraggableStateSnapshot;
  dragHandleProps?: DraggableProvidedDragHandleProps;
}

export default function Window({
  focused,
  tabs,
  incognito,
  state,
  id: windowId,
  windowIndex,
  starred,
  name,
  snapshot: windowSnapshot,
  dragHandleProps
}: chrome.windows.Window & IWindow): JSX.Element {
  const dispatch = useDispatch();

  const [italicizeNonHttp] = useLocalStorage("italicizeNonHttp", false);

  const { available, active } = useSelector((state) => state.groups.present);

  const { id: activeId, index: groupIndex } = active;

  const { inputValue, filterChoice } = useSelector((state) => state.header);
  const { dragType, isDragging } = useSelector((state) => state.dnd);
  const { filteredTabs } = useFilter();

  const typing = inputValue !== "";
  const isTabSearch = filterChoice === "tab";
  const currentTabs = typing && isTabSearch ? filteredTabs[activeId][windowIndex] : tabs;

  const [showPopup, setShowPopup] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const [windowName, setWindowName] = useRename(
    (newName: string) => dispatch(updateWindowName({ groupIndex, windowIndex, name: newName })),
    name ?? `${focused ? "Current " : ""}Window`
  );

  const titleRef = useRef<HTMLInputElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useClickOutside<HTMLDivElement>({ ref: popupRef, preCondition: showPopup, cb: () => setShowPopup(false) });

  const openWindow = useCallback(
    (type: TOpenWindow) => {
      if (groupIndex > 0) {
        (["new", "incognito"] as TOpenWindow[]).includes(type)
          ? chrome.windows.create(
              {
                focused: true,
                type: "normal",
                state,
                incognito: type === "incognito" || incognito,
                url: currentTabs?.map((tab) => tab.url ?? GOOGLE_HOMEPAGE)
              },
              () => ""
            )
          : currentTabs?.forEach((tab) => {
              const { active, pinned, url } = tab ?? {};
              chrome.tabs.create({ active, pinned, url }, () => "");
            });
      } else {
        windowId && chrome.windows.update(windowId, { focused: true });
      }

      setShowPopup(false);
    },
    [currentTabs, groupIndex, incognito, state, windowId]
  );

  const closeWindow = () => {
    if (groupIndex > 0) {
      // Possible to have deleted the last window in the group
      if (available[groupIndex].windows.length === 1) {
        dispatch(deleteGroup({ index: groupIndex }));
      } else {
        dispatch(deleteWindow({ groupIndex, windowIndex }));
      }
    } else {
      windowId && chrome.windows.remove(windowId);
    }
  };

  const tabCounterStr = useMemo(() => {
    const totalTabs = tabs?.length ?? 0;
    const numVisibleTabs = typing ? filteredTabs[activeId][windowIndex]?.length ?? 0 : totalTabs;
    const count = isTabSearch ? numVisibleTabs : totalTabs;

    return `${count}${typing ? ` of ${totalTabs}` : ""} ${pluralize(totalTabs, "Tab")}`;
  }, [typing, filteredTabs, tabs?.length, isTabSearch, activeId, windowIndex]);

  const windowItems = useMemo(
    () => [
      {
        text: "Rename",
        handler: () => {
          const target = titleRef.current;
          if (target) {
            target.focus();
            target.setSelectionRange(target.value.length, target.value.length);
          }

          setShowPopup(false);
        },
        isDisabled: groupIndex === 0
      },
      { text: "divider" },
      ...(groupIndex > 0
        ? [
            { text: "Open In Current", handler: () => openWindow("current") },
            { text: "Open In New", handler: () => openWindow("new"), isDisabled: incognito },
            { text: "Open Incognito", handler: () => openWindow("incognito") }
          ]
        : [{ text: "Focus", handler: () => openWindow("focus") }]),
      { text: "divider" },
      { text: "Copy To Group", handler: () => console.warn("WIP"), isDisabled: true },
      { text: "Move To Group", handler: () => console.warn("WIP"), isDisabled: true },
      { text: "divider" },
      {
        text: starred ? "Unfavorite" : "Favorite",
        handler: () => {
          dispatch(toggleWindowStarred({ groupIndex, windowIndex }));
          setShowPopup(false);
        },
        isDisabled: groupIndex === 0
      },
      {
        text: `${incognito ? "Remove" : "Make"} Incognito`,
        handler: () => {
          dispatch(toggleWindowIncognito({ groupIndex, windowIndex }));
          setShowPopup(false);
        },
        isDisabled: groupIndex === 0
      },
      { text: "divider" },
      {
        text: "Delete",
        handler: () => {
          dispatch(deleteWindow({ groupIndex, windowIndex }));
          setShowPopup(false);
        },
        isDanger: true,
        isDisabled: groupIndex === 0
      }
    ],
    [dispatch, groupIndex, incognito, openWindow, starred, windowIndex]
  );

  const handleWindowTitleUpdate = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isEnter = e.code === "Enter";

    if (!isCtrl && isEnter) titleRef.current?.blur();

    isEnter && setShowPopup(isCtrl);
  };

  const handleContextMenuClick = (e: React.MouseEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.currentTarget.blur();
    setShowPopup(true);
  };

  return (
    <WindowContainer $dragging={windowSnapshot.isDragging} $gap="2px">
      <Row $gap="4px">
        <CloseIcon
          icon="times-circle"
          tabIndex={0}
          onClick={closeWindow}
          onPointerDown={(e) => e.preventDefault()}
          onKeyPress={({ key }) => key === "Enter" && closeWindow()}
        />

        <Headline $active={focused} $dragging={windowSnapshot.isDragging}>
          <IconStack {...dragHandleProps} onContextMenu={(e) => e.preventDefault()}>
            <FontAwesomeIcon icon={incognito ? "mask" : ["far", "window-maximize"]} />
            {starred && <FontAwesomeIcon icon="star" />}
          </IconStack>

          <TitleContainer>
            <StyledWindowTitle
              ref={titleRef}
              $active={focused}
              $open={showPopup}
              $dragging={isDragging}
              {...(windowName.length > 15 ? { title: titleRef.current?.value } : {})}
              tabIndex={0}
              role="button"
              maxLength={25}
              value={windowName}
              onChange={(e) => setWindowName(e.target.value)}
              onClick={(e) => groupIndex === 0 && e.currentTarget.blur()}
              onDoubleClick={(e) => e.button === 0 && openWindow("new")}
              onContextMenu={handleContextMenuClick}
              onKeyPress={handleWindowTitleUpdate}
              onPointerEnter={() => setShowInstructions(true)}
              onPointerLeave={() => setShowInstructions(false)}
            />

            {showPopup && titleRef.current && (
              <div ref={popupRef}>
                <Dropdown
                  items={windowItems}
                  pos={{ top: 0, left: titleRef.current.getBoundingClientRect().width + 10 }}
                  isPopup
                />
              </div>
            )}
          </TitleContainer>

          <TabCounter>{tabCounterStr}</TabCounter>
        </Headline>
      </Row>

      <Droppable droppableId={"window-" + windowIndex} isDropDisabled={!isTabDrag(dragType) || groupIndex === 0}>
        {(provider, dropSnapshot) => (
          <TabsContainer
            ref={provider.innerRef}
            {...provider.droppableProps}
            $draggedOver={dropSnapshot.isDraggingOver}
            $dragOrigin={!!dropSnapshot.draggingFromThisWith}
          >
            {currentTabs?.map((tab, i) => {
              const { title, url, pendingUrl } = tab ?? {};
              const tabUrl = url ?? pendingUrl;
              if (title && tabUrl) {
                return (
                  <Draggable
                    key={title + tabUrl + i}
                    draggableId={`tab-${i}-window-${windowIndex}`}
                    index={i}
                    isDragDisabled={typing && isTabSearch}
                  >
                    {(provided, dragSnapshot) => (
                      <div ref={provided.innerRef} {...provided.draggableProps}>
                        <Tab
                          {...tab}
                          tabIndex={i}
                          windowIndex={windowIndex}
                          italicizeNonHttp={italicizeNonHttp}
                          snapshot={dragSnapshot}
                          dragHandleProps={provided.dragHandleProps}
                        />
                      </div>
                    )}
                  </Draggable>
                );
              }
            })}

            {provider.placeholder}
          </TabsContainer>
        )}
      </Droppable>

      {showInstructions && !showPopup && !isDragging && titleRef.current && (
        <Popup
          text={`Double Click To ${groupIndex > 0 ? "Open" : "Focus"} • Right Click For Options`}
          pos={{
            x: titleRef.current.getBoundingClientRect().right + 8,
            y: titleRef.current.getBoundingClientRect().top - 2
          }}
        />
      )}
    </WindowContainer>
  );
}

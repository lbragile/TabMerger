import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useMemo, useRef, useState } from "react";
import { Draggable, DraggableProvidedDragHandleProps, DraggableStateSnapshot, Droppable } from "react-beautiful-dnd";
import styled from "styled-components";

import Tab from "./Tab";

import Dropdown from "~/components/Dropdown";
import Popup from "~/components/Popup";
import { isTabDrag } from "~/constants/dragRegExp";
import { GOOGLE_HOMEPAGE } from "~/constants/urls";
import useClickOutside from "~/hooks/useClickOutside";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import GROUPS_CREATORS from "~/store/actions/groups";
import { CloseIcon } from "~/styles/CloseIcon";
import { pluralize } from "~/utils/helper";

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
`;

const WindowContainer = styled(Column)<{ $dragging: boolean }>`
  justify-content: center;
  font-size: 14px;
  padding: 0 ${({ $dragging }) => ($dragging ? "4px" : "initial")};
`;

const WindowTitle = styled.div<{ $active: boolean }>`
  font-size: 15px;
  width: fit-content;
  padding: 0 4px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;

  &:hover,
  &:focus-visible {
    background-color: ${({ $active }) => ($active ? "#dde8ffb7" : "#dfdfdfb7")};
  }
`;

const Headline = styled(Column)<{ $active: boolean; $dragging: boolean }>`
  display: grid;
  grid-template-columns: auto 25ch auto;
  column-gap: 6px;
  justify-content: start;
  align-items: center;
  background-color: white;
  padding: 0 2px;
  border: 1px dashed ${({ $dragging }) => ($dragging ? "grey" : "initial")};

  & svg,
  & ${WindowTitle} {
    color: ${({ $active }) => ($active ? "#0080ff" : "initial")};
  }

  & svg {
    max-width: 14px;
  }
`;

const TabsContainer = styled(Column)<{ $draggedOver: boolean; $dragOrigin: boolean }>`
  margin-left: 24px;
  border: 1px dashed ${({ $draggedOver }) => ($draggedOver ? "#0080ff" : "transparent")};
  background-color: ${({ $dragOrigin }) => ($dragOrigin ? "#f5faff" : "white")};
`;

const TabCounter = styled.span`
  color: #808080;
  cursor: default;
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

  &:hover {
    transform: scale(1.25);
    filter: contrast(1.25);
  }
`;

type TOpenWindow = "new" | "current" | "incognito" | "focus";

interface IWindow {
  windowIndex: number;
  starred?: boolean;
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
  snapshot: windowSnapshot,
  dragHandleProps
}: chrome.windows.Window & IWindow): JSX.Element {
  const dispatch = useDispatch();

  const {
    available,
    active: { index: groupIndex }
  } = useSelector((state) => state.groups);

  const { typing, filterChoice } = useSelector((state) => state.header);
  const { filteredTabs } = useSelector((state) => state.filter);
  const { dragType, isDragging } = useSelector((state) => state.dnd);

  const isTabSearch = filterChoice === "tab";
  const currentTabs = typing && isTabSearch ? filteredTabs[windowIndex] : tabs;

  const [showPopup, setShowPopup] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const titleRef = useRef<HTMLDivElement | null>(null);
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
      dispatch(GROUPS_CREATORS.deleteWindow({ groupIndex, windowIndex }));

      // Possible to have deleted the last window in the group
      if (!available[groupIndex].windows.length) {
        dispatch(GROUPS_CREATORS.deleteGroup(groupIndex));
      }
    } else {
      windowId && chrome.windows.remove(windowId);
    }
  };

  const tabCounterStr = useMemo(() => {
    const totalTabs = tabs?.length ?? 0;
    const numVisibleTabs = typing ? filteredTabs[windowIndex]?.length ?? 0 : totalTabs;
    const count = isTabSearch ? numVisibleTabs : totalTabs;

    return `${count}${typing ? ` of ${totalTabs}` : ""} ${pluralize(totalTabs, "Tab")}`;
  }, [typing, filteredTabs, tabs?.length, isTabSearch, windowIndex]);

  const windowItems = useMemo(
    () => [
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
          dispatch(GROUPS_CREATORS.toggleWindowStarred({ groupIndex, windowIndex }));
          setShowPopup(false);
        },
        isDisabled: groupIndex === 0
      },
      {
        text: `${incognito ? "Remove" : "Make"} Incognito`,
        handler: () => {
          dispatch(GROUPS_CREATORS.toggleWindowIncognito({ groupIndex, windowIndex }));
          setShowPopup(false);
        },
        isDisabled: groupIndex === 0
      },
      { text: "divider" },
      {
        text: "Delete",
        handler: () => {
          dispatch(GROUPS_CREATORS.deleteWindow({ groupIndex, windowIndex }));
          setShowPopup(false);
        },
        isDanger: true,
        isDisabled: groupIndex === 0
      }
    ],
    [dispatch, groupIndex, incognito, openWindow, starred, windowIndex]
  );

  return (
    <WindowContainer $dragging={windowSnapshot.isDragging}>
      <Row>
        <CloseIcon
          icon="times-circle"
          tabIndex={0}
          onClick={closeWindow}
          onPointerDown={(e) => e.preventDefault()}
          onKeyPress={({ key }) => key === "Enter" && closeWindow()}
          $visible={!isDragging}
        />

        <Headline $active={focused} $dragging={windowSnapshot.isDragging}>
          <IconStack {...dragHandleProps} onContextMenu={(e) => e.preventDefault()}>
            <FontAwesomeIcon icon={incognito ? "mask" : ["far", "window-maximize"]} />
            {starred && <FontAwesomeIcon icon="star" />}
          </IconStack>

          <TitleContainer>
            <WindowTitle
              ref={titleRef}
              $active={focused}
              tabIndex={0}
              role="button"
              onClick={(e) => e.button === 0 && openWindow("new")}
              onContextMenu={(e) => {
                e.preventDefault();
                setShowPopup(true);
              }}
              onKeyPress={({ key }) => key === "Enter" && setShowPopup(true)}
              onPointerEnter={() => setShowInstructions(true)}
              onPointerLeave={() => setShowInstructions(false)}
            >
              {focused ? "Current" : ""} Window
            </WindowTitle>

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
          text={`Click To ${groupIndex > 0 ? "Open" : "Focus"} • Right Click For Options`}
          pos={{
            x: titleRef.current.getBoundingClientRect().right + 8,
            y: titleRef.current.getBoundingClientRect().top - 4
          }}
        />
      )}
    </WindowContainer>
  );
}

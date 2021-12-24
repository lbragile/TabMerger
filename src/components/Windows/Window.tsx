import { useMemo, useRef, useState } from "react";
import { faMask, faStar, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { faWindowMaximize } from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Tab from "./Tab";
import { pluralize } from "../../utils/helper";
import { useDispatch, useSelector } from "../../hooks/useRedux";
import { Draggable, DraggableProvidedDragHandleProps, DraggableStateSnapshot, Droppable } from "react-beautiful-dnd";
import { isTabDrag } from "../../constants/dragRegExp";
import { CloseIcon } from "../../styles/CloseIcon";
import GROUPS_CREATORS from "../../store/actions/groups";
import useClickOutside from "../../hooks/useClickOutside";
import Dropdown from "../Dropdown";
import Popup from "../Popup";

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
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
  column-gap: 4px;
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
  snapshot: DraggableStateSnapshot;
  dragHandleProps?: DraggableProvidedDragHandleProps;
}

export default function Window({
  focused,
  tabs,
  incognito,
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

  const currentTabs = typing && filterChoice === "tab" ? filteredTabs[windowIndex] : tabs;

  const [showPopup, setShowPopup] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const titleRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useClickOutside<HTMLDivElement>({ ref: popupRef, preCondition: showPopup, cb: () => setShowPopup(false) });

  const openWindow = (type: TOpenWindow) => {
    if (groupIndex > 0) {
      const isIncognito = type === "incognito" || incognito;

      (["new", "incognito"] as TOpenWindow[]).includes(type)
        ? chrome.windows.create({
            focused: true,
            ...(!isIncognito ? { state: "maximized" } : {}),
            type: "normal",
            incognito: isIncognito,
            url: currentTabs?.map((tab) => tab.url ?? "https://www.google.com")
          })
        : currentTabs?.forEach((tab) => {
            const { active, pinned, url } = tab ?? {};
            chrome.tabs.create({ active, pinned, url });
          });
    } else {
      windowId && chrome.windows.update(windowId, { focused: true });
    }

    setShowPopup(false);
  };

  const closeWindow = () => {
    if (groupIndex > 0) {
      dispatch(GROUPS_CREATORS.closeWindow({ groupIndex, windowIndex }));

      // possible to have deleted the last window in the group
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
    const count = filterChoice === "tab" ? numVisibleTabs : totalTabs;

    return `${count}${typing ? ` of ${totalTabs}` : ""} ${pluralize(totalTabs, "Tab")}`;
  }, [typing, filteredTabs, tabs?.length, filterChoice, windowIndex]);

  return (
    <WindowContainer $dragging={windowSnapshot.isDragging}>
      <Row>
        <CloseIcon
          icon={faTimesCircle}
          tabIndex={0}
          onClick={closeWindow}
          onPointerDown={(e) => e.preventDefault()}
          onKeyPress={({ key }) => key === "Enter" && closeWindow()}
          $visible={!isDragging}
        />

        <Headline $active={focused} $dragging={windowSnapshot.isDragging}>
          <IconStack {...dragHandleProps} onContextMenu={(e) => e.preventDefault()}>
            <FontAwesomeIcon
              title={`${starred ? "Favorite " : ""}${incognito ? "Incognito" : "Regular"} Window`}
              icon={incognito ? faMask : faWindowMaximize}
            />
            {starred && <FontAwesomeIcon icon={faStar} />}
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
                  items={[
                    ...(groupIndex > 0
                      ? [
                          { text: "Open In Current", handler: () => openWindow("current") },
                          { text: "Open In New", handler: () => openWindow("new"), isDisabled: incognito },
                          { text: "Open Incognito", handler: () => openWindow("incognito") }
                        ]
                      : [{ text: "Focus", handler: () => openWindow("focus") }]),
                    { text: "divider" },
                    { text: "Copy To Group", handler: () => console.log("WIP") },
                    { text: "Move To Group", handler: () => console.log("WIP") },
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
                    { text: "Rename", handler: () => console.log("WIP") },
                    {
                      text: "Delete",
                      handler: () => {
                        dispatch(GROUPS_CREATORS.deleteWindow({ groupIndex, windowIndex }));
                        setShowPopup(false);
                      },
                      isDanger: true,
                      isDisabled: groupIndex === 0
                    }
                  ]}
                  pos={{
                    top: 0,
                    left: titleRef.current.getBoundingClientRect().width + 10
                  }}
                  isPopup
                />
              </div>
            )}
          </TitleContainer>

          <TabCounter>{tabCounterStr}</TabCounter>
        </Headline>
      </Row>

      <Droppable droppableId={"window-" + windowIndex} isDropDisabled={!isTabDrag(dragType)}>
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
                  <Draggable key={title + tabUrl + i} draggableId={`tab-${i}-window-${windowIndex}`} index={i}>
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

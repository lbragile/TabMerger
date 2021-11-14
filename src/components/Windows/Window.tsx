import React, { useMemo, useRef, useState } from "react";
import { faTimesCircle, faWindowMaximize } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Tab from "./Tab";
import { pluralize } from "../../utils/helper";
import { useSelector } from "../../hooks/useSelector";
import { Draggable, DraggableProvidedDragHandleProps, DraggableStateSnapshot, Droppable } from "react-beautiful-dnd";
import { isTabDrag } from "../../constants/dragRegExp";

const Flex = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Container = styled(Flex)<{ $dragging: boolean }>`
  justify-content: center;
  margin: 12px 0 0 12px;
  font-size: 14px;
  background-color: white;
  border: 1px dashed ${({ $dragging }) => ($dragging ? "grey" : "initial")};
`;

const WindowTitle = styled.div`
  font-size: 15px;
  width: fit-content;
  cursor: pointer;
`;

const Headline = styled(Flex)<{ active: boolean }>`
  display: grid;
  grid-template-columns: auto 150px auto auto;
  column-gap: 8px;
  justify-content: start;
  align-items: center;

  & svg,
  & ${WindowTitle} {
    color: ${({ active }) => (active ? "#0080ff" : "")};
  }
`;

const TabsContainer = styled(Flex)<{ $draggedOver: boolean; $dragOrigin: boolean }>`
  margin-top: 8px;
  border: 1px dashed ${({ $draggedOver }) => ($draggedOver ? "blue" : "transparent")};
  background-color: ${({ $dragOrigin }) => ($dragOrigin ? "aliceblue" : "white")};
`;

const TabCounter = styled.span`
  color: #808080;
  cursor: default;
`;

const CloseIcon = styled(FontAwesomeIcon)`
  visibility: hidden;
  pointer-events: none;
  cursor: none;

  && {
    color: #ff4040;
  }

  ${Headline}:hover & {
    visibility: visible;
    pointer-events: all;
    cursor: pointer;
  }
`;

const Popup = styled.div<{ $left: number }>`
  position: absolute;
  top: -8px;
  left: ${({ $left }) => $left + 10 + "px"};
  background-color: #303030;
  display: flex;
  flex-direction: column;
  min-width: 175px;
  padding: 4px;

  &::before {
    position: absolute;
    top: 12px;
    right: 100%;
    content: "";
    border: 6px solid transparent;
    border-right: 6px solid #303030;
  }
`;

const PopupChoice = styled.button`
  background: inherit;
  cursor: pointer;
  padding: 12px 8px;
  border: none;
  outline: none;
  text-align: left;
  color: white;

  &:hover {
    background-color: #42a4ff;
  }
`;

const TitleContainer = styled.div`
  position: relative;
`;

type TOpenWindow = "new" | "current" | "incognito";

const WINDOW_TITLE_POPUP_CHOICES: { type: TOpenWindow; text: string }[] = [
  { type: "current", text: "Open In Current" },
  { type: "new", text: "Open In New" },
  { type: "incognito", text: "Open Incognito" }
];

export default function Window({
  focused,
  tabs,
  incognito,
  id: windowId,
  index,
  snapshot: windowSnapshot,
  dragHandleProps
}: chrome.windows.Window & {
  index: number;
  snapshot: DraggableStateSnapshot;
  dragHandleProps: DraggableProvidedDragHandleProps | undefined;
}): JSX.Element {
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { filteredTabs } = useSelector((state) => state.filter);
  const { dragType, dragOverGroup } = useSelector((state) => state.dnd);

  const currentTabs = typing ? filteredTabs[index] : tabs;

  const titleRef = useRef<HTMLDivElement | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  const openWindow = (where: TOpenWindow) => {
    ["new", "incognito"].includes(where)
      ? chrome.windows.create({
          focused: true,
          state: "maximized",
          type: "normal",
          incognito: where === "incognito" ? true : incognito,
          url: currentTabs?.map((tab) => tab.url ?? "https://www.google.com")
        })
      : currentTabs?.forEach((tab) => {
          const { active, pinned, url } = tab ?? {};
          chrome.tabs.create({ active, pinned, url });
        });
  };

  const closeWindow = () => windowId && chrome.windows.remove(windowId);

  const tabCounterStr = useMemo(() => {
    const totalTabs = tabs?.length ?? 0;
    const numVisibleTabs = typing ? filteredTabs[index]?.length ?? 0 : totalTabs;
    const count = filterChoice === "tab" ? numVisibleTabs : totalTabs;

    return `${count}${typing ? ` of ${totalTabs}` : ""} ${pluralize(totalTabs, "Tab")}`;
  }, [typing, filteredTabs, tabs?.length, filterChoice, index]);

  return (
    <Container $dragging={windowSnapshot.isDragging} onDragStart={(e) => e.preventDefault()}>
      <Headline active={focused} draggable>
        <div {...dragHandleProps}>
          <FontAwesomeIcon icon={faWindowMaximize} />
        </div>

        <TitleContainer onBlur={() => setTimeout(() => setShowPopup(false), 100)}>
          <WindowTitle
            ref={titleRef}
            tabIndex={0}
            role="button"
            onClick={(e) => {
              // left click
              if (e.button === 0) openWindow("new");
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setShowPopup(true);
            }}
            onKeyPress={(e) => e.key === "Enter" && setShowPopup(true)}
          >
            {focused ? "Current" : ""} Window
          </WindowTitle>

          {showPopup && (
            <Popup $left={titleRef.current?.clientWidth ?? 0}>
              {WINDOW_TITLE_POPUP_CHOICES.map((choice) => (
                <PopupChoice
                  key={choice.text}
                  tabIndex={0}
                  onClick={() => openWindow(choice.type)}
                  onKeyPress={(e) => e.key === "Enter" && openWindow(choice.type)}
                >
                  {choice.text}
                </PopupChoice>
              ))}
            </Popup>
          )}
        </TitleContainer>

        <TabCounter>{tabCounterStr}</TabCounter>

        <CloseIcon
          icon={faTimesCircle}
          tabIndex={0}
          onMouseDown={(e) => {
            e.preventDefault();
            closeWindow();
          }}
          onKeyPress={(e) => e.key === "Enter" && closeWindow()}
        />
      </Headline>

      <Droppable droppableId={"window-" + index} isDropDisabled={!isTabDrag(dragType) || dragOverGroup > 1}>
        {(provider, dropSnapshot) => (
          <TabsContainer
            ref={provider.innerRef}
            {...provider.droppableProps}
            $draggedOver={dropSnapshot.isDraggingOver}
            $dragOrigin={!!dropSnapshot.draggingFromThisWith}
          >
            {currentTabs?.map((tab, i) => {
              const { title, url } = tab ?? {};
              if (title && url) {
                return (
                  <Draggable key={title + url + i} draggableId={`tab-${i}-window-${index}`} index={i}>
                    {(provided, dragSnapshot) => (
                      <div ref={provided.innerRef} {...provided.draggableProps}>
                        <Tab {...tab} snapshot={dragSnapshot} dragHandleProps={provided.dragHandleProps} />
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
    </Container>
  );
}

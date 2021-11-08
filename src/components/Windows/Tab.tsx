import React, { useCallback, useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Highlighted from "../Highlighted";
import { updateTabs } from "../../store/actions/groups";
import { useDispatch } from "../../hooks/useDispatch";

interface IStyledTabContainer {
  $dragging: boolean;
  $move: { x: number; y: number };
}

const TabContainer = styled.div.attrs<IStyledTabContainer>((props) => ({
  ...props,
  style: {
    left: props.$move.x + "px",
    top: props.$move.y + "px"
  }
}))<IStyledTabContainer>`
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  justify-content: start;
  gap: 8px;
  max-width: 320px;
  ${({ $dragging }) => css`
    cursor: ${$dragging ? "grabbing" : "grab"};
    background-color: ${$dragging ? "#d6f9ff" : "initial"};
    z-index: ${$dragging ? "10" : "initial"};
    position: ${$dragging ? "absolute" : "initial"};
  `};
`;

const TabTitle = styled.span<{ $isDragging: boolean }>`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    text-decoration: ${({ $isDragging }) => ($isDragging ? "none" : "underline")};
    cursor: ${({ $isDragging }) => ($isDragging ? "grabbing" : "pointer")};
  }
`;

const TabIcon = styled.img`
  height: 14px;
  width: 14px;
`;

const CloseIcon = styled(FontAwesomeIcon)`
  && {
    cursor: pointer;
    color: transparent;

    &:hover {
      color: #ff4040;
    }
  }
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const TAB_DROPPABLE_CLASS = ".tab-droppable";

export default function Tab({
  favIconUrl,
  title,
  url,
  active,
  pinned,
  id: tabId,
  groupIdx,
  windowIdx,
  tabIdx
}: chrome.tabs.Tab & { groupIdx: number; windowIdx: number; tabIdx: number }): JSX.Element {
  const dispatch = useDispatch();

  const { filterChoice } = useSelector((state) => state.header);

  const openTab = () => chrome.tabs.create({ url, active, pinned });
  const closeTab = () => tabId && chrome.tabs.remove(tabId);

  /** Current drag item */
  const tabRef = useRef<HTMLDivElement | null>(null);
  const destInfo = useRef("");

  const [isDragging, setIsDragging] = useState(false);
  const [move, setMove] = useState({ x: 0, y: 0 });

  const adjustPosition = useCallback((pageX: number, pageY: number, dragUpwards: boolean, dragging = true) => {
    const target = tabRef.current;
    if (target) {
      const { width, height } = target.getBoundingClientRect();
      const offset = { x: 8 + width / 2, y: 8 + height / 2 };

      if (dragging) {
        setMove({
          x: Math.max(offset.x, Math.min(pageX + offset.x - 16, window.innerWidth - offset.x)) - width / 2,
          y: Math.max(offset.y + 54, Math.min(pageY, window.innerHeight - offset.y)) - height / 2
        });

        // need to hide current dragging element, capture element below, then show it
        target.style.display = "none";
        const elemUnder = document.elementFromPoint(pageX, pageY);
        target.style.display = "";

        // add dragging element to the dom depending on the drag direction
        const closestTab = elemUnder?.closest(TAB_DROPPABLE_CLASS);
        const dragTab = target.closest(TAB_DROPPABLE_CLASS);
        if (closestTab && dragTab) {
          const closestDataIndex = closestTab.getAttribute("data-index");
          const dragDataIndex = dragTab.getAttribute("data-index");

          if (closestDataIndex && dragDataIndex && closestDataIndex !== dragDataIndex) {
            // only swap places when movement is past the half way point of the closest tab ...
            // ... taking into account drag direction
            const { top: closestTop, height: closestHeight } = closestTab.getBoundingClientRect();
            const closestTabMiddle = closestTop + closestHeight / 2;

            if (dragUpwards && pageY < closestTabMiddle) {
              closestTab.insertAdjacentElement("beforebegin", dragTab);
            } else if (!dragUpwards && pageY >= closestTabMiddle) {
              closestTab.insertAdjacentElement("afterend", dragTab);
            }

            // store information for pointer up event
            destInfo.current = closestDataIndex;
          }
        }
      }
    }
  }, []);

  /** Dragging event starts when the tab favicon is pressed */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    adjustPosition(e.pageX, e.pageY, e.movementY < 0);
  };

  /** Trigger the following events on the document rather than on the tab favicon to prevent weird behavior */
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      adjustPosition(e.pageX, e.pageY, e.movementY < 0, isDragging);
    };

    const onPointerUp = (e: PointerEvent) => {
      e.preventDefault();

      if (isDragging) {
        setIsDragging(false);

        // Update the state as DOM manipulation is now complete
        dispatch(
          updateTabs({
            src: `${tabIdx}-${windowIdx}-${groupIdx}`,
            dest: destInfo.current
          })
        );
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dispatch, isDragging, move, adjustPosition, tabIdx, windowIdx, groupIdx]);

  return (
    <Row className={TAB_DROPPABLE_CLASS.slice(1)} data-index={`${tabIdx}-${windowIdx}-${groupIdx}`}>
      <CloseIcon
        icon={faTimesCircle}
        tabIndex={0}
        onClick={() => closeTab()}
        onKeyPress={(e) => e.key === "Enter" && closeTab()}
      />

      <TabContainer ref={tabRef} $dragging={isDragging} $move={move}>
        <TabIcon
          src={
            favIconUrl === "" || !favIconUrl
              ? "https://developer.chrome.com/images/meta/favicon-32x32.png"
              : favIconUrl?.replace("-dark", "")
          }
          alt="Favicon of the tab"
          onPointerDown={onPointerDown}
        />

        <TabTitle
          title={url}
          $isDragging={isDragging}
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

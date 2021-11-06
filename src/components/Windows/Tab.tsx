import React, { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Highlighted from "../Highlighted";

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
    background-color: ${$dragging ? "lightblue" : "initial"};
    z-index: ${$dragging ? "10" : "initial"};
    position: ${$dragging ? "absolute" : "initial"};
  `};
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

export default function Tab({
  favIconUrl,
  title,
  url,
  active,
  pinned,
  id: tabId,
  groupIndex,
  windowIndex
}: chrome.tabs.Tab & { groupIndex: number; windowIndex: number }): JSX.Element {
  const { filterChoice } = useSelector((state) => state.header);

  const openTab = () => chrome.tabs.create({ url, active, pinned });
  const closeTab = () => tabId && chrome.tabs.remove(tabId);

  const tabRef = useRef<HTMLDivElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [move, setMove] = useState({ x: 0, y: 0 });

  function adjustPosition(pageX: number, pageY: number, dragging = true) {
    const target = tabRef.current;
    if (target) {
      const { width, height } = target.getBoundingClientRect();
      const offset = { x: 8 + width / 2, y: 8 + height / 2 };

      if (dragging) {
        setMove({
          x: Math.max(offset.x, Math.min(pageX + offset.x - 16, window.innerWidth - offset.x)) - width / 2,
          y: Math.max(offset.y + 54, Math.min(pageY, window.innerHeight - offset.y)) - height / 2
        });
      }
    }
  }

  /** Dragging event starts when the tab favicon is pressed */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    adjustPosition(e.pageX, e.pageY);
  };

  /** Trigger the following events on the document rather than on the tab favicon to prevent weird behavior */
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      adjustPosition(e.pageX, e.pageY, isDragging);
    };

    const onPointerUp = (e: PointerEvent) => {
      e.preventDefault();
      setIsDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [isDragging, move]);

  return (
    <Row>
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

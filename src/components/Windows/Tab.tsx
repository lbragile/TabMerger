import React, { useRef } from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { faLongArrowAltRight, faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Highlighted from "../Highlighted";

const Grid = styled.div`
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  justify-content: start;
  gap: 8px;
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
  visibility: hidden;
  pointer-events: none;
  cursor: none;
  justify-self: end;

  && {
    color: #ff4040;
  }

  ${Grid}:hover & {
    visibility: visible;
    pointer-events: all;
    cursor: pointer;
  }
`;

const DraggingArrowIndicator = styled.div`
  position: fixed;
  display: none;
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
  const arrowRef = useRef<HTMLDivElement | null>(null);

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const dragData = { favIconUrl, title, url, active, pinned, tabId };
    e.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ data: dragData, extraInfo: { windowIndex, groupIndex }, type: "tab" })
    );

    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(new Image(), 0, 0); // hide ghost
    } else if (tabRef.current) {
      const target = tabRef.current;
      target.style.display = "none";
      setTimeout(() => (target.style.display = "initial"), 0);
    }
  };

  const onDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    const target = tabRef.current;
    if (target) {
      const { width } = target.getBoundingClientRect();
      target.style.position = "absolute";
      target.style.top = e.pageY + 5 + "px";
      target.style.left = e.pageX - width / 2 + "px";
      target.style.width = "30ch";
    }
  };

  const onDragEnd = () => {
    const tabTarget = tabRef.current;

    if (tabTarget) {
      tabTarget.style.position = "initial";
      tabTarget.style.width = "initial";
    }
  };

  const onDragEnter = () => {
    const arrowTarget = arrowRef.current;

    if (arrowTarget) {
      arrowTarget.style.display = "inline";
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const arrowTarget = arrowRef.current;
    const tabTarget = tabRef.current;

    if (tabTarget && arrowTarget) {
      const { top, height, bottom } = tabTarget.getBoundingClientRect();
      console.log(top, height, bottom, e.pageY);
      const arrowPos = e.pageY > (bottom - top) / 2 ? bottom : top;
      arrowTarget.style.top = arrowPos - height / 4 + "px";
    }
  };

  const onDragLeave = () => {
    const arrowTarget = arrowRef.current;

    if (arrowTarget) {
      arrowTarget.style.display = "none";
    }
  };

  const onDrop = () => {
    const arrowTarget = arrowRef.current;

    if (arrowTarget) {
      arrowTarget.style.display = "none";
    }
  };

  return (
    <>
      <Grid
        ref={tabRef}
        draggable
        onDragStart={onDragStart}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <TabIcon
          src={
            favIconUrl === "" || !favIconUrl
              ? "https://developer.chrome.com/images/meta/favicon-32x32.png"
              : favIconUrl?.replace("-dark", "")
          }
          alt="Favicon of the tab"
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

        <CloseIcon
          icon={faTimesCircle}
          tabIndex={0}
          onClick={() => closeTab()}
          onKeyPress={(e) => e.key === "Enter" && closeTab()}
        />
      </Grid>

      <DraggingArrowIndicator ref={arrowRef}>
        <FontAwesomeIcon icon={faLongArrowAltRight} color="rgb(0 128 255)" />
      </DraggingArrowIndicator>
    </>
  );
}

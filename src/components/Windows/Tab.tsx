import React, { useRef } from "react";
import styled from "styled-components";

const Flex = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const TabTitle = styled.span`
  max-width: 90%;
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

export default function Tab(tab: chrome.tabs.Tab): JSX.Element {
  const tabRef = useRef<HTMLSpanElement | null>(null);
  const { favIconUrl, title, url, active, pinned } = tab;

  return (
    <Flex>
      <TabIcon
        src={favIconUrl === "" ? "https://developer.chrome.com/images/meta/favicon-32x32.png" : favIconUrl}
        alt="Favicon of the tab"
      />

      <TabTitle
        title={url}
        ref={tabRef}
        role="link"
        tabIndex={0}
        onClick={async () => await chrome.tabs.create({ url, active, pinned })}
        onMouseOver={() => console.log("show preview")}
        onFocus={(e) => (tabRef.current = e.target)}
        onKeyPress={(e) => {
          if (e.key === "o") {
            console.log("open tab from keyboard");
          }
        }}
      >
        {title}
      </TabTitle>
    </Flex>
  );
}

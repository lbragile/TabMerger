import React from "react";
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

interface ITab {
  favIconUrl?: string;
  title: string;
  url: string;
}

export default function Tab({ favIconUrl, title, url }: ITab): JSX.Element {
  return (
    <Flex>
      <TabIcon
        src={favIconUrl === "" ? "https://developer.chrome.com/images/meta/favicon-32x32.png" : favIconUrl}
        alt="Favicon of the tab"
      />{" "}
      <TabTitle
        title={url}
        onClick={() => console.log("open tab in corresponding window")}
        onMouseOver={() => console.log("show preview")}
      >
        {title}
      </TabTitle>
    </Flex>
  );
}

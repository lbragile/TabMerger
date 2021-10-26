import React from "react";
import { faTimesCircle, faWindowMaximize } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Tab from "./Tab";
import { pluralize } from "../../utils/helper";

const Flex = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Container = styled(Flex)`
  justify-content: center;
  margin: 16px 0 0 24px;
  font-size: 14px;
`;

const WindowTitle = styled.span`
  font-size: 16px;
  width: fit-content;
  cursor: pointer;
`;

const Headline = styled(Flex).attrs((props: { active: boolean }) => props)`
  display: grid;
  grid-template-columns: auto 150px auto auto;
  column-gap: 8px;
  justify-content: start;
  font-size: 16px;

  & svg,
  & ${WindowTitle} {
    color: ${({ active }) => (active ? "#0080ff" : "")};
  }
`;

const TabsContainer = styled(Flex)`
  margin: 8px 0 0 24px;
`;

const TabCounter = styled.span`
  opacity: 0.5;
  margin-left: 16px;
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

export default function Window({ focused, tabs, incognito, id: windowId }: chrome.windows.Window): JSX.Element {
  const openWindow = () =>
    chrome.windows.create({
      focused,
      incognito,
      state: "maximized",
      type: "normal",
      url: tabs?.map((tab) => tab.url ?? "https://www.google.com")
    });

  const closeWindow = () => windowId && chrome.windows.remove(windowId);

  return (
    <Container>
      <Headline active={focused}>
        <FontAwesomeIcon icon={faWindowMaximize} />

        <WindowTitle
          tabIndex={0}
          role="button"
          onMouseDown={(e) => {
            e.preventDefault();
            openWindow();
          }}
          onKeyPress={(e) => e.key === "Enter" && openWindow()}
        >
          {focused ? "Current" : ""} Window
        </WindowTitle>

        <TabCounter>
          {tabs?.length ?? 0} {pluralize(tabs?.length ?? 0, "Tab")}
        </TabCounter>

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

      <TabsContainer>
        {tabs?.map((tab, i) => {
          const { title, url } = tab ?? {};
          if (title && url) {
            return <Tab key={title + url + i} {...tab} />;
          }
        })}
      </TabsContainer>
    </Container>
  );
}

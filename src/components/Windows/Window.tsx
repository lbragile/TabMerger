import React, { useMemo } from "react";
import { faTimesCircle, faWindowMaximize } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Tab from "./Tab";
import { pluralize } from "../../utils/helper";
import { useSelector } from "../../hooks/useSelector";

const Flex = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Container = styled(Flex)`
  justify-content: center;
  margin: 12px 0 0 12px;
  font-size: 14px;
`;

const WindowTitle = styled.span`
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

const TabsContainer = styled(Flex)`
  margin: 8px 0 0 8px;
`;

const TabCounter = styled.span`
  opacity: 0.5;
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

export default function Window({
  focused,
  tabs,
  incognito,
  id: windowId,
  index
}: chrome.windows.Window & { index: number }): JSX.Element {
  const { typing, filterChoice } = useSelector((state) => state.header);
  const { filteredTabs } = useSelector((state) => state.filter);

  const currentTabs = typing ? filteredTabs[index] : tabs;

  const openWindow = () =>
    chrome.windows.create({
      focused: true,
      state: "maximized",
      type: "normal",
      incognito,
      url: currentTabs?.map((tab) => tab.url ?? "https://www.google.com")
    });

  const closeWindow = () => windowId && chrome.windows.remove(windowId);

  const tabCounterStr = useMemo(() => {
    const totalTabs = tabs?.length ?? 0;
    const numVisibleTabs = typing ? filteredTabs[index]?.length ?? 0 : totalTabs;
    const count = filterChoice === "tab" ? numVisibleTabs + (typing ? ` of ${totalTabs} ` : "") : totalTabs;

    return `${count} ${pluralize(totalTabs, "Tab")}`;
  }, [typing, filteredTabs, tabs?.length, filterChoice, index]);

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

      <TabsContainer>
        {currentTabs?.map((tab, i) => {
          const { title, url } = tab ?? {};
          if (title && url) {
            return <Tab key={title + url + i} {...tab} />;
          }
        })}
      </TabsContainer>
    </Container>
  );
}

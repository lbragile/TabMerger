import React, { useMemo, useRef, useState } from "react";
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

const TabsContainer = styled(Flex)`
  margin: 8px 0 0 8px;
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
  top: 0;
  left: ${({ $left }) => $left + 10 + "px"};
  background-color: white;
  box-shadow: 2px 2px 10px 2px #efefef;
  display: flex;
  flex-direction: column;
  min-width: 175px;
  padding: 4px;

  &::before {
    position: absolute;
    top: 2px;
    right: 100%;
    content: "";
    border: 6px solid transparent;
    border-right: 6px solid #ababab;
  }
`;

const PopupChoice = styled.div`
  background: inherit;
  cursor: pointer;
  padding: 12px 8px;

  &:hover {
    background-color: #cce6ff;
  }
`;

const TitleContainer = styled.div`
  position: relative;
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

  const titleRef = useRef<HTMLDivElement | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  const openWindow = (where: "new" | "current" | "incognito") => {
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
    <Container>
      <Headline active={focused}>
        <FontAwesomeIcon icon={faWindowMaximize} />

        <TitleContainer>
          <WindowTitle
            ref={titleRef}
            tabIndex={0}
            role="button"
            onMouseDown={(e) => {
              // left click
              if (e.button === 0) {
                e.preventDefault();
                openWindow("new");
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setShowPopup(true);
            }}
            onKeyPress={(e) => e.key === "Enter" && setShowPopup(true)}
            onBlur={() => setShowPopup(false)}
          >
            {focused ? "Current" : ""} Window
          </WindowTitle>

          {showPopup && (
            <Popup $left={titleRef.current?.clientWidth ?? 0}>
              <PopupChoice role="button" tabIndex={0} onMouseDown={() => openWindow("current")}>
                Open In Current
              </PopupChoice>
              <PopupChoice role="button" tabIndex={0} onMouseDown={() => openWindow("new")}>
                Open In New
              </PopupChoice>
              <PopupChoice role="button" tabIndex={0} onMouseDown={() => openWindow("incognito")}>
                Open Incognito
              </PopupChoice>
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

import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
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

export default function Tab({
  favIconUrl,
  title,
  url,
  active,
  pinned,
  id: tabId
}: chrome.tabs.Tab): JSX.Element | null {
  const { inputValue, filterChoice } = useSelector((state) => state.header);

  const openTab = () => chrome.tabs.create({ url, active, pinned });
  const closeTab = () => tabId && chrome.tabs.remove(tabId);

  return (filterChoice === "tab" && title?.toLowerCase().includes(inputValue.toLowerCase())) ||
    filterChoice === "group" ? (
    <Grid>
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
        onMouseDown={(e) => {
          e.preventDefault();
          openTab();
        }}
        onKeyPress={(e) => e.key === "Enter" && openTab()}
      >
        {filterChoice === "tab" ? <Highlighted text={title} /> : title}
      </TabTitle>

      <CloseIcon
        icon={faTimesCircle}
        tabIndex={0}
        onMouseDown={(e) => {
          e.preventDefault();
          closeTab();
        }}
        onKeyPress={(e) => e.key === "Enter" && closeTab()}
      />
    </Grid>
  ) : null;
}

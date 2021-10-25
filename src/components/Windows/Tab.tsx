import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React from "react";
import styled from "styled-components";
import { useSelector } from "../../hooks/useSelector";

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

const MarkedText = styled.mark`
  background-color: #ffd580;
`;

const Highlighted = ({ text = "" }: { text: string }): JSX.Element => {
  const { inputValue } = useSelector((state) => state.header);

  if (!inputValue.trim()) return <span>{text}</span>;

  /**
   * The brackets around the re variable keeps it in the array when splitting and does not affect testing
   * @example 'react'.split(/(ac)/gi) => ['re', 'ac', 't']
   */
  const re = new RegExp(`(${inputValue})`, "gi");

  return (
    <span>
      {text
        .split(re)
        .map((part, i) =>
          re.test(part) ? <MarkedText key={part + i}>{part}</MarkedText> : <span key={part + i}>{part}</span>
        )}
    </span>
  );
};

export default function Tab({
  favIconUrl,
  title,
  url,
  active,
  pinned,
  id: tabId
}: chrome.tabs.Tab): JSX.Element | null {
  const { inputValue } = useSelector((state) => state.header);

  const openTab = async () => await chrome.tabs.create({ url, active, pinned });
  const closeTab = async () => tabId && (await chrome.tabs.remove(tabId));

  return title?.includes(inputValue) ? (
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
        onClick={openTab}
        onKeyPress={(e) => e.key === "Enter" && openTab()}
      >
        <Highlighted text={title} />
      </TabTitle>

      <CloseIcon
        icon={faTimesCircle}
        tabIndex={0}
        onClick={closeTab}
        onKeyPress={(e) => e.key === "Enter" && closeTab()}
      />
    </Grid>
  ) : null;
}
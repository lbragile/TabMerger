import { useEffect, useMemo, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { useDispatch } from "../hooks/useDispatch";
import { useSelector } from "../hooks/useSelector";
import { faCog, faSearch, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import SearchResult from "./SearchResult";
import HEADER_CREATORS from "../store/actions/header";
import FILTERS_CREATORS from "../store/actions/filter";
import Dropdown from "./Dropdown";
import useClickOutside from "../hooks/useClickOutside";
import { saveAs } from "file-saver";

const Flex = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const Container = styled(Flex)`
  background-color: #94c9ff;
  width: 100%;
  height: 49px;
  padding: 8px;
`;

const InputContainer = styled(Flex)`
  width: 210px;
  height: 39px;
  padding: 8px;
  background-color: #cce6ff;
`;

const SearchInput = styled.input`
  background-color: inherit;
  max-width: 85%;
  white-space: nowrap;
  text-overflow: ellipsis;
  outline: none;
  border: none;
  font-size: 16px;
`;

const SettingsIcon = styled(FontAwesomeIcon)`
  font-size: 32px;
  padding: 4px;
  cursor: pointer;

  &:hover {
    background-color: #cce6ffaa;
  }
`;

const SearchIcon = styled(FontAwesomeIcon)<{ $typing: boolean }>`
  font-size: 16px;
  color: ${({ $typing }) => ($typing ? "black" : "#808080")};

  &:hover {
    ${({ $typing: typing }) =>
      css`
        cursor: ${typing ? "pointer" : ""};
        color: ${typing ? "#FF8080" : ""};
      `}
  }
`;

const FilterButtonToggle = styled.div`
  display: flex;
  flex-direction: row;
  border: 1px solid #cce6ff;
  margin: 0 8px;
`;

const FilterChoice = styled.button<{ active: boolean }>`
  background-color: ${({ active }) => (active ? "#cce6ff" : "inherit")};
  min-width: 50px;
  padding: 4px 8px;
  border: none;
  outline: none;
  cursor: pointer;
  font-weight: 600;
`;

export default function Header(): JSX.Element {
  const dispatch = useDispatch();

  const { typing, inputValue, filterChoice } = useSelector((state) => state.header);
  const { available, active } = useSelector((state) => state.groups);

  const [showDropdown, setShowDropdown] = useState(false);

  const settingsIconRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useClickOutside<HTMLDivElement>({
    ref: dropdownRef,
    preCondition: showDropdown,
    cb: () => setShowDropdown(false)
  });

  /**
   * For each window in the currently active group, store the matching tabs (with current filter value)
   * @returns 2d array of tabs where each index corresponds to the matching tabs in that window
   */
  useEffect(() => {
    if (typing && filterChoice === "tab") {
      const matchingTabs: chrome.tabs.Tab[][] = [];

      available[active.index].windows.forEach((window) => {
        const matchingTabsInWindow = window.tabs?.filter((tab) =>
          tab?.title?.toLowerCase()?.includes(inputValue.toLowerCase())
        );
        matchingTabsInWindow && matchingTabs.push(matchingTabsInWindow ?? []);
      });

      dispatch(FILTERS_CREATORS.updateFilteredTabs(matchingTabs));
    } else if (typing && filterChoice === "group") {
      const matchingGroups = available.filter((group) => group.name.toLowerCase().includes(inputValue.toLowerCase()));
      dispatch(FILTERS_CREATORS.updateFilteredGroups(matchingGroups));
    }
  }, [dispatch, typing, inputValue, available, active.index, filterChoice]);

  const settingsItems = useMemo(() => {
    return [
      { text: "Import", handler: () => "" },
      {
        text: "Export",
        handler: () => {
          // TODO show menu where user can select between text, json, ect.
          const blob = new Blob([JSON.stringify({ active, available }, null, 2)], { type: "application/json" });
          saveAs(blob, `TabMerger Export - ${new Date().toTimeString()}`);
        }
      },
      { text: "Sync", handler: () => "" },
      { text: "Print", handler: () => "" },
      { text: "divider" },
      { text: "Settings", handler: () => "" },
      {
        text: "Help",
        handler: () => chrome.tabs.create({ url: "https://lbragile.github.io/TabMerger-Extension/faq" })
      },
      { text: "divider" },
      {
        text: "Rate",
        handler: () =>
          chrome.tabs.create({
            url: "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/reviews/"
          })
      },
      {
        text: "Donate",
        handler: () =>
          chrome.tabs.create({
            url: process.env.REACT_APP_PAYPAL_URL
          })
      },
      { text: "divider" },
      {
        text: "About",
        handler: () => chrome.tabs.create({ url: "https://lbragile.github.io/TabMerger-Extension/#about-section" })
      }
    ];
  }, [active, available]);

  return (
    <>
      <Container>
        <Flex>
          <InputContainer>
            <SearchInput
              type="text"
              placeholder="Search..."
              spellCheck={false}
              value={inputValue as string}
              onChange={(e) => {
                const { value } = e.target;
                dispatch(HEADER_CREATORS.updateInputValue(value));
                dispatch(HEADER_CREATORS.setTyping(value !== ""));
              }}
            />

            <SearchIcon
              {...(typing ? { tabIndex: 0 } : {})}
              icon={typing ? faTimes : faSearch}
              $typing={typing}
              onClick={() => {
                // clicking the close button should clear the input
                if (typing) {
                  dispatch(HEADER_CREATORS.updateInputValue(""));
                  dispatch(HEADER_CREATORS.setTyping(false));
                }
              }}
            />
          </InputContainer>

          {typing && (
            <FilterButtonToggle>
              {["tab", "group"].map((text) => (
                <FilterChoice
                  key={text}
                  onMouseDown={() => dispatch(HEADER_CREATORS.setFilterChoice(text))}
                  active={filterChoice === text}
                >
                  {text[0].toUpperCase() + text.slice(1)}
                </FilterChoice>
              ))}
            </FilterButtonToggle>
          )}
        </Flex>

        <div ref={settingsIconRef}>
          <SettingsIcon
            tabIndex={0}
            icon={faCog}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setShowDropdown(!showDropdown)}
            onKeyPress={({ key }) => key === "Enter" && setShowDropdown(!showDropdown)}
          />
        </div>
      </Container>

      {showDropdown && settingsIconRef.current && (
        <div ref={dropdownRef}>
          <Dropdown
            items={settingsItems}
            pos={{ top: settingsIconRef.current.getBoundingClientRect().height + 16, right: 8 }}
          />
        </div>
      )}

      {typing && filterChoice === "group" && <SearchResult type="group" />}
    </>
  );
}

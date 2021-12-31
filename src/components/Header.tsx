import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useRef, useState } from "react";
import styled, { css } from "styled-components";

import Dropdown, { IDropdown } from "./Dropdown";
import Modal, { IModal } from "./Modal";
import SearchResult from "./SearchResult";

import useClickOutside from "~/hooks/useClickOutside";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import FILTERS_CREATORS from "~/store/actions/filter";
import HEADER_CREATORS from "~/store/actions/header";
import { createActiveTab } from "~/utils/helper";

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
  const [showModal, setShowModal] = useState(false);
  const [modalDetails, setModalDetails] = useState<Omit<IModal, "setVisible">>({
    title: "About TabMerger",
    type: "about",
    closeText: "Close"
  });

  const settingsIconRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useClickOutside<HTMLDivElement>({ ref: dropdownRef, preCondition: showDropdown, cb: () => setShowDropdown(false) });

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

  const modalDetailsHandler = (args: Omit<IModal, "setVisible">) => {
    setShowModal(true);
    setShowDropdown(false);
    setModalDetails(args);
  };

  const settingsItems = useMemo(() => {
    return [
      { text: "Import", handler: () => modalDetailsHandler({ title: "Import", type: "import", closeText: "Cancel" }) },
      {
        text: "Export",
        handler: () =>
          modalDetailsHandler({ title: "Export", type: "export", closeText: "Close", saveText: "Save File" })
      },
      { text: "Sync", handler: () => console.warn("WIP"), isDisabled: true },
      { text: "divider" },
      {
        text: "Settings",
        handler: () => modalDetailsHandler({ title: "TabMerger Settings", type: "settings", closeText: "Cancel" })
      },
      {
        text: "Help",
        handler: () => createActiveTab("https://groups.google.com/g/tabmerger")
      },
      { text: "divider" },
      {
        text: "Rate",
        handler: () =>
          createActiveTab(
            "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/reviews/"
          )
      },
      {
        text: "Donate",
        handler: () => createActiveTab(process.env.REACT_APP_PAYPAL_URL ?? "chrome://newtab")
      },
      { text: "divider" },
      {
        text: "About",
        handler: () => modalDetailsHandler({ title: "About TabMerger", type: "about", closeText: "Close" })
      }
    ] as IDropdown["items"];
  }, []);

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
              icon={typing ? "times" : "search"}
              $typing={typing}
              onClick={() => {
                // Clicking the close button should clear the input
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
            icon="cog"
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

      {typing && filterChoice === "group" && <SearchResult />}

      {showModal && <Modal {...modalDetails} setVisible={setShowModal} />}
    </>
  );
}

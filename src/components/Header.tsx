import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useMemo, useRef, useState } from "react";
import styled, { css } from "styled-components";

import Dropdown, { IDropdown } from "./Dropdown";
import Modal from "./Modal";
import SearchResult from "./SearchResult";

import { TABMERGER_HELP, TABMERGER_REVIEWS } from "~/constants/urls";
import useClickOutside from "~/hooks/useClickOutside";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { updateInputValue, setFilterChoice } from "~/store/actions/header";
import { setModalInfo } from "~/store/actions/modal";
import { IModalState } from "~/store/reducers/modal";
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
  ${({ $typing }) =>
    $typing &&
    css`
      &:hover {
        cursor: pointer;
        color: #ff8080;
      }
    `}
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

  const { inputValue, filterChoice } = useSelector((state) => state.header);
  const typing = inputValue !== "";

  const [showDropdown, setShowDropdown] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const settingsIconRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useClickOutside<HTMLDivElement>({ ref: dropdownRef, preCondition: showDropdown, cb: () => setShowDropdown(false) });

  const modalDetailsHandler = useCallback(
    (args: IModalState["info"]) => {
      setShowModal(true);
      setShowDropdown(false);
      dispatch(setModalInfo(args));
    },
    [dispatch]
  );

  const settingsItems = useMemo(() => {
    return [
      {
        text: "Import",
        handler: () =>
          modalDetailsHandler({ title: "TabMerger Import", type: "import", closeText: "Cancel", saveText: "Import" })
      },
      {
        text: "Export",
        handler: () =>
          modalDetailsHandler({ title: "TabMerger Export", type: "export", closeText: "Close", saveText: "Save File" })
      },
      {
        text: "Sync",
        handler: () =>
          modalDetailsHandler({ title: "TabMerger Sync", type: "sync", saveText: "Sync", closeText: "Cancel" })
      },
      { text: "divider" },
      {
        text: "Settings",
        handler: () => modalDetailsHandler({ title: "TabMerger Settings", type: "settings", closeText: "Cancel" }),
        isDisabled: true
      },
      { text: "Help", handler: () => createActiveTab(TABMERGER_HELP) },
      { text: "divider" },
      { text: "Rate", handler: () => createActiveTab(TABMERGER_REVIEWS) },
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
  }, [modalDetailsHandler]);

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
                dispatch(updateInputValue(value));
              }}
            />

            <SearchIcon
              {...(typing ? { tabIndex: 0 } : {})}
              icon={typing ? "times" : "search"}
              $typing={typing}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                // Clicking the close button should clear the input
                if (typing) {
                  dispatch(updateInputValue(""));
                }
              }}
            />
          </InputContainer>

          {typing && (
            <FilterButtonToggle>
              {["tab", "group"].map((text) => (
                <FilterChoice
                  key={text}
                  onMouseDown={() => dispatch(setFilterChoice(text))}
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

      {showModal && <Modal setVisible={setShowModal} />}
    </>
  );
}

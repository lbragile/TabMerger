import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import Dropdown, { IDropdown } from "./Dropdown";
import Modal from "./Modal";
import SearchResult from "./SearchResult";

import { CHROME_NEW_TAB, TABMERGER_HELP, TABMERGER_REVIEWS } from "~/constants/urls";
import useClickOutside from "~/hooks/useClickOutside";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { updateInputValue, setFilterChoice, setFocused } from "~/store/actions/header";
import { setModalType, setVisibility } from "~/store/actions/modal";
import { CloseIcon } from "~/styles/CloseIcon";
import { Row } from "~/styles/Row";
import { TModalType } from "~/typings/settings";
import { createActiveTab } from "~/utils/helper";

const StyledRow = styled(Row)`
  justify-content: space-between;
`;

const Container = styled(StyledRow)`
  background-color: #94c9ff;
  width: 100%;
  height: 49px;
  padding: 8px;
`;

const InputContainer = styled(StyledRow)`
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
  color: black;

  &:hover {
    background-color: #cce6ffaa;
  }
`;

const SearchIcon = styled(FontAwesomeIcon)`
  font-size: 16px;
  color: black;
`;

const StyledCloseIcon = styled(CloseIcon)`
  && {
    font-size: 16px;
    color: black;
    opacity: 1;
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

  const { inputValue, filterChoice, focused } = useSelector((state) => state.header);
  const { visible } = useSelector((state) => state.modal);
  const typing = inputValue !== "";

  const [showDropdown, setShowDropdown] = useState(false);

  const settingsIconRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useClickOutside<HTMLDivElement>({ ref: dropdownRef, preCondition: showDropdown, cb: () => setShowDropdown(false) });

  useEffect(() => {
    if (focused && searchRef.current) {
      searchRef.current.focus();
    }
  }, [focused]);

  const modalDetailsHandler = useCallback(
    (type: TModalType) => {
      setShowDropdown(false);
      dispatch(setVisibility(true));
      dispatch(setModalType(type));
    },
    [dispatch]
  );

  const settingsItems = useMemo(() => {
    return [
      { text: "Import", handler: () => modalDetailsHandler("import") },
      { text: "Export", handler: () => modalDetailsHandler("export") },
      { text: "Sync", handler: () => modalDetailsHandler("sync") },
      { text: "divider" },
      { text: "Settings", handler: () => modalDetailsHandler("settings") },
      { text: "Help", handler: () => createActiveTab(TABMERGER_HELP) },
      { text: "divider" },
      { text: "Rate", handler: () => createActiveTab(TABMERGER_REVIEWS) },
      { text: "Donate", handler: () => createActiveTab(process.env.REACT_APP_PAYPAL_URL ?? CHROME_NEW_TAB) },
      { text: "divider" },
      { text: "About", handler: () => modalDetailsHandler("about") }
    ] as IDropdown["items"];
  }, [modalDetailsHandler]);

  return (
    <>
      <Container>
        <StyledRow>
          <InputContainer>
            <SearchInput
              ref={searchRef}
              type="text"
              placeholder="Search..."
              spellCheck={false}
              value={inputValue}
              onBlur={() => dispatch(setFocused(false))}
              onChange={(e) => {
                const { value } = e.target;
                dispatch(updateInputValue(value));
              }}
            />

            {typing ? (
              <StyledCloseIcon
                tabIndex={0}
                icon="times"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => typing && dispatch(updateInputValue(""))}
              />
            ) : (
              <SearchIcon icon="search" />
            )}
          </InputContainer>

          {typing && (
            <FilterButtonToggle>
              {(["tab", "group"] as ("tab" | "group")[]).map((text) => (
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
        </StyledRow>

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

      {visible && <Modal />}
    </>
  );
}

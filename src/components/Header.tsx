import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionCreators } from "redux-undo";
import styled from "styled-components";

import Dropdown from "./Dropdown";
import Modal from "./Modal";
import ProgressBar from "./ProgressBar";
import SearchResult from "./SearchResult";

import type { IDropdown } from "./Dropdown";
import type { TModalType } from "~/typings/settings";

import { CHROME_NEW_TAB, TABMERGER_HELP, TABMERGER_REVIEWS } from "~/constants/urls";
import useClickOutside from "~/hooks/useClickOutside";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import useUndoProgress from "~/hooks/useUndoProgress";
import { updateInputValue, setFilterChoice, setFocused } from "~/store/actions/header";
import { setModalType, setVisibility } from "~/store/actions/modal";
import { CloseIcon } from "~/styles/CloseIcon";
import { Row } from "~/styles/Row";
import { createActiveTab } from "~/utils/helper";

const StyledRow = styled(Row)`
  justify-content: space-between;
`;

const Container = styled(StyledRow)`
  background-color: #94c9ff;
  width: 100%;
  height: 49px;
  padding: 0 8px;
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

const UndoWarningPrompt = styled.div`
  position: relative;
  color: black;
  background: #ffed6b;
  min-width: 150px;
  height: 100%;
  display: grid;
  place-items: center;
`;

const UndoCTA = styled.div`
  cursor: pointer;
  font-weight: bold;

  &:hover {
    text-decoration: underline;
  }
`;

const CloseIconContainer = styled.span`
  padding: 4px 8px;
  cursor: pointer;
  display: flex;
  position: absolute;
  top: 0;
  right: 0;

  & ${CloseIcon} {
    font-size: 12px;
  }

  &:hover {
    background-color: #ff000020;

    & ${CloseIcon} {
      color: red;
    }
  }
`;

export default function Header(): JSX.Element {
  const dispatch = useDispatch();

  const { inputValue, filterChoice, focused, showUndo } = useSelector((state) => state.header);
  const { visible } = useSelector((state) => state.modal);
  const typing = inputValue !== "";

  const [confirmDelete] = useLocalStorage("confirmDelete", true);
  const [showDropdown, setShowDropdown] = useState(false);

  const settingsIconRef = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useClickOutside<HTMLDivElement>({ ref: dropdownRef, preCondition: showDropdown, cb: () => setShowDropdown(false) });

  const { resetTimer, completed } = useUndoProgress();

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
      { text: "Settings", handler: () => modalDetailsHandler("settings") },
      { text: "divider" },
      { text: "Import", handler: () => modalDetailsHandler("import") },
      { text: "Export", handler: () => modalDetailsHandler("export") },
      { text: "Sync", handler: () => modalDetailsHandler("sync") },
      { text: "divider" },
      { text: "Help", handler: () => createActiveTab(TABMERGER_HELP) },
      { text: "Rate", handler: () => createActiveTab(TABMERGER_REVIEWS) },
      { text: "Donate", handler: () => createActiveTab(process.env.REACT_APP_PAYPAL_URL ?? CHROME_NEW_TAB) },
      { text: "About", handler: () => modalDetailsHandler("about") }
    ] as IDropdown["items"];
  }, [modalDetailsHandler]);

  const undoHandler = () => {
    dispatch(ActionCreators.undo());
    resetTimer();
  };

  const closeUndoPrompt = () => {
    resetTimer();
  };

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

        {showUndo && confirmDelete && (
          <UndoWarningPrompt>
            <UndoCTA
              tabIndex={0}
              role="button"
              onClick={undoHandler}
              onKeyDown={(e) => e.preventDefault()}
              onKeyPress={({ code }) => code === "Enter" && undoHandler()}
            >
              Undo
            </UndoCTA>

            <CloseIconContainer
              tabIndex={0}
              role="button"
              onClick={closeUndoPrompt}
              onKeyDown={(e) => e.preventDefault()}
              onKeyPress={({ code }) => code === "Enter" && closeUndoPrompt}
            >
              <StyledCloseIcon icon="times" />
            </CloseIconContainer>

            <ProgressBar completed={completed} />
          </UndoWarningPrompt>
        )}

        <div ref={settingsIconRef}>
          <SettingsIcon
            tabIndex={0}
            icon="cog"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setShowDropdown(!showDropdown)}
            onKeyPress={({ code }) => code === "Enter" && setShowDropdown(!showDropdown)}
          />
        </div>
      </Container>

      {showDropdown && settingsIconRef.current && (
        <div ref={dropdownRef}>
          <Dropdown
            items={settingsItems}
            pos={{ top: settingsIconRef.current.getBoundingClientRect().height + 8, right: 8 }}
          />
        </div>
      )}

      {typing && filterChoice === "group" && <SearchResult />}

      {visible && <Modal />}
    </>
  );
}

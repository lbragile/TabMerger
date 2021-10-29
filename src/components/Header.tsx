import React, { useEffect, useMemo } from "react";
import styled, { css } from "styled-components";
import { useDispatch } from "../hooks/useDispatch";
import { useSelector } from "../hooks/useSelector";
import { setFilterChoice, setGroupCount, setTabCount, setTyping, updateInputValue } from "../store/actions/header";
import { faCog, faSearch, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import SearchResult from "./SearchResult";

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
  border-radius: 4px;
  width: 209px;
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
  font-size: 24px;
  cursor: pointer;

  &:hover {
    color: #404040;
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
  border-radius: 10em;
  margin: 0 8px;
`;

const FilterChoice = styled.button<{ active: boolean }>`
  background-color: ${({ active }) => (active ? "#cce6ff" : "inherit")};
  min-width: 50px;
  padding: 4px 8px;
  border-radius: 10em;
  border: none;
  outline: none;
  cursor: pointer;
  font-weight: 600;
`;

export default function Header(): JSX.Element {
  const dispatch = useDispatch();
  const { typing, inputValue, filterChoice } = useSelector((state) => state.header);

  const { available, active } = useSelector((state) => state.groups);

  /**
   * For each window in the currently active group count the number of matching tabs (with current filter value)
   * @returns count array where each index corresponds to the number of matching tabs in that window
   * @example [0, 3, 5] → current window has 0, window has 3, window has 5 matching tabs
   */
  const numFilteredTabs = useMemo(() => {
    const tabCount: number[] = [];

    if (typing && filterChoice === "tab") {
      available[active.index].windows.forEach((window) => {
        const numMatchingTabs =
          window.tabs?.filter((tab) => tab?.title?.toLowerCase()?.includes(inputValue.toLowerCase()))?.length ?? 0;
        tabCount.push(numMatchingTabs);
      });
    }

    return tabCount;
  }, [typing, inputValue, available, active.index, filterChoice]);

  const numFilteredGroups = useMemo(() => {
    return available.filter((group) => group.name.toLowerCase().includes(inputValue.toLowerCase())).length;
  }, [available, inputValue]);

  useEffect(() => {
    dispatch(setTabCount(numFilteredTabs));
  }, [dispatch, numFilteredTabs]);

  useEffect(() => {
    dispatch(setGroupCount(numFilteredGroups));
  }, [dispatch, numFilteredGroups]);

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
                dispatch(setTyping(value !== ""));
              }}
            />

            <SearchIcon
              icon={typing ? faTimes : faSearch}
              $typing={typing}
              onClick={() => {
                // clicking the close button should clear the input
                if (typing) {
                  dispatch(updateInputValue(""));
                  dispatch(setTyping(false));
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

        <SettingsIcon icon={faCog} />
      </Container>

      {typing && filterChoice === "group" && <SearchResult type="group" />}
    </>
  );
}

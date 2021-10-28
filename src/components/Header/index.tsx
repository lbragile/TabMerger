import React, { useState } from "react";
import styled, { css } from "styled-components";
import { useDispatch } from "../../hooks/useDispatch";
import { useSelector } from "../../hooks/useSelector";
import { setTyping, updateInputValue } from "../../store/actions/header";
import { faCog, faFilter, faSearch, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Radio from "./Radio";

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

const SearchIcon = styled(FontAwesomeIcon).attrs((props: { $typing: boolean }) => props)`
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

const FilterContainer = styled.div`
  position: relative;
`;

const FilterIcon = styled(FontAwesomeIcon)`
  font-size: 16px;
  cursor: pointer;
  margin-left: 8px;

  &:hover {
    color: #404040;
  }
`;

const FilterOptsContainer = styled.div`
  width: 120px;
  max-height: 200px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  row-gap: 8px;
  background: white;
  border: 1px solid #808080;
  border-radius: 4px;
  position: absolute;
  top: calc(100% + 10px);
  left: 10px;
`;

const VerticalSpacer = styled.div`
  height: 4px;
`;

const CloseIcon = styled(FontAwesomeIcon)`
  font-size: 14px;
  color: #404040;
  cursor: pointer;

  &:hover {
    color: #ff8080;
  }
`;

const FilterHeaderRow = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
`;

export default function Header(): JSX.Element {
  const dispatch = useDispatch();
  const { typing, inputValue, filterChoice } = useSelector((state) => state.header);

  const [showFilterOpts, setShowFilterOpts] = useState(false);

  return (
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
                setShowFilterOpts(false);
              }
            }}
          />
        </InputContainer>

        <FilterContainer>
          {typing && (
            <FilterIcon
              icon={faFilter}
              tabIndex={0}
              onMouseDown={(e) => {
                e.preventDefault();
                setShowFilterOpts(!showFilterOpts);
              }}
            />
          )}

          {showFilterOpts && (
            <FilterOptsContainer>
              <FilterHeaderRow>
                <h2>Search</h2>
                <CloseIcon icon={faTimes} onClick={() => setShowFilterOpts(false)} />
              </FilterHeaderRow>
              <Radio label="Current" />
              <Radio label="Global" />

              {filterChoice.search === "global" && (
                <>
                  <VerticalSpacer />
                  <h2>Include</h2>
                  <Radio label="Tab" />
                  <Radio label="Group" />
                </>
              )}
            </FilterOptsContainer>
          )}
        </FilterContainer>
      </Flex>

      <SettingsIcon icon={faCog} />
    </Container>
  );
}

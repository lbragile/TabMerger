import { faCog, faFilter, faSearch, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React from "react";
import styled, { css } from "styled-components";
import { useDispatch } from "../hooks/useDispatch";
import { useSelector } from "../hooks/useSelector";
import { setTyping, updateInputValue } from "../store/actions/header";

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
  width: 203px;
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
`;

const SettingsIcon = styled(FontAwesomeIcon)`
  font-size: 24px;
  cursor: pointer;

  &:hover {
    color: #404040;
  }
`;

const SearchIcon = styled(FontAwesomeIcon).attrs((props: { $isTyping: boolean }) => props)`
  font-size: 16px;

  &:hover {
    ${({ $isTyping: typing }) =>
      css`
        cursor: ${typing ? "pointer" : ""};
        color: ${typing ? "#FF8080" : ""};
      `}
  }
`;

const FilterIcon = styled(FontAwesomeIcon)`
  font-size: 16px;
  cursor: pointer;
  margin-left: 8px;

  &:hover {
    color: #404040;
  }
`;

export default function Header(): JSX.Element {
  const dispatch = useDispatch();
  const { typing, inputValue } = useSelector((state) => state.header);

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
            $isTyping={typing}
            onClick={() => {
              // clicking the close button should clear the input
              if (typing) {
                dispatch(updateInputValue(""));
                dispatch(setTyping(false));
              }
            }}
          />
        </InputContainer>

        {typing && <FilterIcon icon={faFilter} />}
      </Flex>

      <SettingsIcon icon={faCog} />
    </Container>
  );
}

import { faSearch, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useMemo } from "react";
import { useDispatch } from "react-redux";
import styled from "styled-components";
import { useSelector } from "../hooks/useSelector";
import { setTyping, updateInputValue } from "../store/actions/header";
import { pluralize } from "../utils/helper";

const StyledResult = styled.div<{ $isPositive: boolean; $isGroup: boolean }>`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  background-color: ${({ $isPositive }) => ($isPositive ? "#14b866" : "#F53D3D")};
  color: white;
  border-radius: 4px;
  padding: 8px;
  margin: 16px 0 8px 0;
  font-size: 14px;
  width: calc(100% - ${({ $isGroup }) => ($isGroup ? "16px" : "0")});
  text-align: center;

  & b {
    font-weight: 700;
  }
`;

const CloseIcon = styled(FontAwesomeIcon)`
  cursor: pointer;
`;

const SearchIcon = styled(FontAwesomeIcon)`
  margin-right: 8px;
`;

export default function SearchResult({ type }: { type: "tab" | "group" }): JSX.Element {
  const dispatch = useDispatch();
  const { tabCount, groupCount, inputValue } = useSelector((state) => state.header);

  const tabSum = useMemo(() => tabCount.reduce((current, total) => current + total, 0), [tabCount]);

  return (
    <StyledResult $isPositive={(type === "tab" ? tabSum : groupCount) > 0} $isGroup={type === "group"}>
      <div>
        <SearchIcon icon={faSearch} />

        {type === "tab" ? (
          <span>
            <b>{inputValue}</b>{" "}
            {tabSum > 0 ? (
              <span>
                matches <b>{tabSum}</b> {pluralize(tabSum, "tab")}
              </span>
            ) : (
              <span>does not match any tab</span>
            )}{" "}
            in this group
          </span>
        ) : (
          <span>
            <b>{inputValue}</b>{" "}
            {groupCount > 0 ? (
              <span>
                matches <b>{groupCount}</b> {pluralize(groupCount, "group")}
              </span>
            ) : (
              <span>does not match any group</span>
            )}
          </span>
        )}
      </div>

      <CloseIcon
        icon={faTimes}
        onClick={() => {
          dispatch(setTyping(false));
          dispatch(updateInputValue(""));
        }}
      />
    </StyledResult>
  );
}

import { faSearch, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useMemo } from "react";
import { useDispatch } from "react-redux";
import styled from "styled-components";
import { useSelector } from "../hooks/useSelector";
import HEADER_CREATORS from "../store/actions/header";
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
  margin: ${({ $isGroup }) => ($isGroup ? "12px 0 4px 0" : "0 0 12px 0")};
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
  const { inputValue } = useSelector((state) => state.header);
  const { filteredTabs, filteredGroups } = useSelector((state) => state.filter);

  const tabsCount = useMemo(
    () => filteredTabs.reduce((total, windowTabs) => windowTabs.length + total, 0),
    [filteredTabs]
  );

  const groupsCount = filteredGroups.length;

  return (
    <StyledResult $isPositive={(type === "tab" ? tabsCount : groupsCount) > 0} $isGroup={type === "group"}>
      <div>
        <SearchIcon icon={faSearch} />

        {type === "tab" ? (
          <span>
            <b>{inputValue}</b>{" "}
            {tabsCount > 0 ? (
              <span>
                matches <b>{tabsCount}</b> {pluralize(tabsCount, "tab")}
              </span>
            ) : (
              <span>does not match any tab</span>
            )}{" "}
            in this group
          </span>
        ) : (
          <span>
            <b>{inputValue}</b>{" "}
            {groupsCount > 0 ? (
              <span>
                matches <b>{groupsCount}</b> {pluralize(groupsCount, "group")}
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
          dispatch(HEADER_CREATORS.setTyping(false));
          dispatch(HEADER_CREATORS.updateInputValue(""));
        }}
      />
    </StyledResult>
  );
}

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useMemo } from "react";
import styled, { css } from "styled-components";

import { useDispatch, useSelector } from "~/hooks/useRedux";
import HEADER_CREATORS from "~/store/actions/header";
import { pluralize } from "~/utils/helper";

const StyledResult = styled.div<{ $isPositive: boolean; $isGroup: boolean }>`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  background-color: ${({ $isPositive }) => ($isPositive ? "#14b866" : "#F53D3D")};
  color: white;
  padding: 4px 8px;
  font-size: 14px;
  width: calc(100% - ${({ $isGroup }) => ($isGroup ? "16px" : "0")});
  text-align: center;
  ${({ $isGroup }) =>
    $isGroup
      ? css`
          margin-top: 8px;
        `
      : css`
          margin-bottom: 8px;
        `};

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

export default function SearchResult(): JSX.Element {
  const dispatch = useDispatch();
  const { inputValue, filterChoice: type } = useSelector((state) => state.header);
  const { filteredTabs, filteredGroups } = useSelector((state) => state.filter);

  const tabsCount = useMemo(
    () => filteredTabs.reduce((total, windowTabs) => windowTabs.length + total, 0),
    [filteredTabs]
  );

  const groupsCount = filteredGroups.length;
  const isTabSearch = type === "tab";
  const countToShow = isTabSearch ? tabsCount : groupsCount;

  const handleClearSearch = () => {
    dispatch(HEADER_CREATORS.setTyping(false));
    dispatch(HEADER_CREATORS.updateInputValue(""));
  };

  return (
    <StyledResult $isPositive={countToShow > 0} $isGroup={!isTabSearch}>
      <div>
        <SearchIcon icon="search" />

        <span>
          <b>{inputValue}</b>{" "}
          {countToShow > 0 ? (
            <span>
              matches <b>{countToShow}</b> {pluralize(countToShow, type)}
            </span>
          ) : (
            <span>does not match any {type}</span>
          )}{" "}
          {isTabSearch && "in this group"}
        </span>
      </div>

      <CloseIcon
        icon="times"
        tabIndex={0}
        onClick={handleClearSearch}
        onKeyPress={({ key }) => key === "Enter" && handleClearSearch()}
      />
    </StyledResult>
  );
}

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useMemo } from "react";
import styled from "styled-components";

import useFilter from "~/hooks/useFilter";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { updateInputValue } from "~/store/actions/header";
import { CloseIcon } from "~/styles/CloseIcon";
import { Message } from "~/styles/Message";
import { pluralize } from "~/utils/helper";

const StyledResult = styled(Message)<{ $isGroup: boolean }>`
  justify-content: space-between;
  font-size: 14px;
  width: ${({ $isGroup }) => ($isGroup ? "calc(100% - 16px)" : "100%")};
  font-weight: normal;
  margin: ${({ $isGroup }) => ($isGroup ? "8px 0 0 0" : "0 0 4px 0")};
  border: 1px solid currentcolor;

  & b {
    font-weight: 700;
  }
`;

const StyledCloseIcon = styled(CloseIcon)`
  && {
    color: black;
    opacity: 1;
  }
`;

const SearchIcon = styled(FontAwesomeIcon)`
  color: black;
  margin-right: 8px;
`;

export default function SearchResult(): JSX.Element {
  const dispatch = useDispatch();
  const { inputValue, filterChoice } = useSelector((state) => state.header);
  const { active } = useSelector((state) => state.groups);

  const { filteredTabs, filteredGroups } = useFilter();

  const tabsCount = useMemo(
    () => filteredTabs[active.id].reduce((total, windowTabs) => windowTabs.length + total, 0),
    [filteredTabs, active]
  );

  const groupsCount = filteredGroups.length;
  const isTabSearch = filterChoice === "tab";
  const countToShow = isTabSearch ? tabsCount : groupsCount;

  return (
    <StyledResult $error={countToShow === 0} $recent={countToShow > 0} $isGroup={!isTabSearch}>
      <div>
        <SearchIcon icon="search" />

        <span>
          <b>{inputValue}</b>{" "}
          {countToShow > 0 ? (
            <span>
              matches <b>{countToShow}</b> {pluralize(countToShow, filterChoice)}
            </span>
          ) : (
            <span>does not match any {filterChoice}</span>
          )}{" "}
          {isTabSearch && "in this group"}
        </span>
      </div>

      <StyledCloseIcon
        icon="times"
        tabIndex={0}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => dispatch(updateInputValue(""))}
        onKeyPress={({ key }) => key === "Enter" && dispatch(updateInputValue(""))}
      />
    </StyledResult>
  );
}

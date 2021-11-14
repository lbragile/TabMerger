import React from "react";
import styled from "styled-components";
import { faEllipsisV } from "@fortawesome/free-solid-svg-icons";
import { faWindowRestore } from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IGroupState } from "../../store/reducers/groups";
import { useDispatch } from "../../hooks/useDispatch";
import GROUPS_CREATORS from "../../store/actions/groups";
import { getReadableTimestamp } from "../../utils/helper";

const Grid = styled.div`
  display: grid;
  grid-template-columns: auto auto;
  row-gap: 12px;
  justify-content: space-between;
  align-items: start;
  white-space: nowrap;
  padding: 0;
  margin-bottom: 8px;
`;

const LeftColumn = styled.div`
  justify-self: start;
`;

const RightColumn = styled.div`
  justify-self: end;
`;

const SettingsIcon = styled(FontAwesomeIcon)`
  cursor: pointer;
  font-size: 16px;
`;

const OpenIcon = styled(FontAwesomeIcon)`
  cursor: pointer;
  margin-right: 8px;
  font-size: 16px;
`;

const Title = styled.input<{ $maxLength: boolean }>`
  font-weight: bold;
  font-size: 16px;
  border: none;
  outline: none;
  border-bottom: 1px solid transparent;
  width: 200px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;

  &:hover {
    border-bottom: 1px solid rgba(0, 0, 0, 0.2);
  }

  &:focus {
    border-bottom: 1px solid black;
    background-color: ${({ $maxLength }) => ($maxLength ? "#ffd1d1" : "initial")};
  }
`;

const SubTitle = styled.span`
  font-size: 14px;
`;

interface IInformation extends Pick<IGroupState, "info" | "name" | "updatedAt"> {
  index: number;
}

export default function Information({ info, name, index, updatedAt }: IInformation): JSX.Element {
  const dispatch = useDispatch();

  return (
    <Grid>
      <LeftColumn>
        <Title
          type="text"
          value={name}
          spellCheck={false}
          onChange={({ target: { value } }) => {
            value.length <= 50 && dispatch(GROUPS_CREATORS.updateName({ index, name: value }));
          }}
          $maxLength={name.length === 50}
        />
      </LeftColumn>

      <RightColumn>
        <OpenIcon icon={faWindowRestore} tabIndex={0} />
        <SettingsIcon icon={faEllipsisV} tabIndex={0} />
      </RightColumn>

      <LeftColumn>
        <SubTitle>{getReadableTimestamp(updatedAt)}</SubTitle>
      </LeftColumn>

      <RightColumn>
        <SubTitle>{info}</SubTitle>
      </RightColumn>
    </Grid>
  );
}

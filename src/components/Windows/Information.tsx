import React, { useEffect, useState } from "react";
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
  grid-template-columns: 3fr 1fr;
  row-gap: 8px;
  justify-content: space-between;
  align-items: start;
  padding: 2px 0;
  margin-bottom: 12px;
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

const Title = styled.input<{ $isMaxLength: boolean }>`
  font-weight: bold;
  font-size: 16px;
  border: none;
  outline: none;
  border-bottom: 1px solid transparent;
  width: 300px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;

  &:hover {
    border-bottom: 1px solid rgba(0, 0, 0, 0.2);
  }

  &:focus {
    border-bottom: 1px solid black;
    background-color: ${({ $isMaxLength }) => ($isMaxLength ? "#ffd1d1" : "initial")};
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

  const [windowTitle, setWindowTitle] = useState("");
  useEffect(() => setWindowTitle(name), [name]);

  return (
    <Grid>
      <LeftColumn>
        <Title
          type="text"
          value={windowTitle}
          spellCheck={false}
          onChange={(e) => setWindowTitle(e.target.value)}
          onBlur={() => dispatch(GROUPS_CREATORS.updateName({ index, name: windowTitle }))}
          onKeyPress={(e) => e.key === "Enter" && e.currentTarget.blur()}
          maxLength={40}
          $isMaxLength={windowTitle.length === 40}
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

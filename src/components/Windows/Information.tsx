import React from "react";
import styled from "styled-components";
import { faEllipsisV } from "@fortawesome/free-solid-svg-icons";
import { faWindowRestore } from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IGroupState } from "../../store/reducers/groups";

const Grid = styled.div`
  display: grid;
  grid-template-columns: auto auto;
  row-gap: 12px;
  justify-content: space-between;
  align-items: start;
  white-space: nowrap;
  padding: 4px 0;
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

const Title = styled.span`
  font-weight: bold;
  font-size: 16px;
`;

const SubTitle = styled.span`
  font-size: 14px;
`;

export default function Information({ info, name }: Pick<IGroupState, "info" | "name">): JSX.Element {
  return (
    <Grid>
      <LeftColumn>
        <Title>{name}</Title>
      </LeftColumn>
      <RightColumn>
        <OpenIcon icon={faWindowRestore} />
        <SettingsIcon icon={faEllipsisV} />
      </RightColumn>
      <LeftColumn>
        <SubTitle>Updated 10/12/2021 8:27:52 PM</SubTitle>
      </LeftColumn>
      <RightColumn>
        <SubTitle>{info}</SubTitle>
      </RightColumn>
    </Grid>
  );
}

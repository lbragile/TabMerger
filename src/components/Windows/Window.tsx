import React from "react";
import { faWindowMaximize } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Tab from "./Tab";
import { IGroupState } from "../../store/reducers/groups";
import { pluralize } from "../../utils/helper";

const Flex = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Container = styled(Flex)`
  justify-content: center;
  margin: 16px 0 0 24px;
  font-size: 14px;
`;

const WindowTitle = styled.span`
  font-size: 16px;
`;

const Headline = styled(Flex).attrs((props: { active: boolean }) => props)`
  flex-direction: row;
  align-items: center;
  min-width: 150px;
  font-size: 16px;

  & svg,
  & ${WindowTitle} {
    color: ${({ active }) => (active ? "#0080ff" : "")};
  }
`;

const TabsContainer = styled(Flex)`
  margin: 8px 0 0 24px;
`;

const TabCounter = styled.span`
  opacity: 0.5;
  margin-left: 16px;
`;

export default function Window({ active, tabs, id }: IGroupState["windows"][number]): JSX.Element {
  return (
    <Container>
      <Headline active={active}>
        <FontAwesomeIcon icon={faWindowMaximize} />
        <WindowTitle>{active ? "Current" : ""} Window</WindowTitle>
        <TabCounter>
          {tabs.length} {pluralize(tabs.length, "Tab")}
        </TabCounter>
      </Headline>

      <TabsContainer>
        {tabs.map((tab, i) => (
          <Tab key={tab.title + tab.url + i} icon={tab.icon} title={tab.title} url={tab.url} />
        ))}
      </TabsContainer>
    </Container>
  );
}

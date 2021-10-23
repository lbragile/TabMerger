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

export default function Window({ focused, tabs }: IGroupState["windows"][number]): JSX.Element {
  return (
    <Container>
      <Headline active={focused}>
        <FontAwesomeIcon icon={faWindowMaximize} />
        <WindowTitle>{focused ? "Current" : ""} Window</WindowTitle>
        <TabCounter>
          {tabs?.length ?? 0} {pluralize(tabs?.length ?? 0, "Tab")}
        </TabCounter>
      </Headline>

      <TabsContainer>
        {tabs?.map((tab, i) => {
          const { title, url, favIconUrl } = tab ?? {};
          if (title && url) {
            return <Tab key={title + url + i} favIconUrl={favIconUrl} title={title} url={url} />;
          }
        })}
      </TabsContainer>
    </Container>
  );
}

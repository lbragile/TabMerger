import React from "react";
import styled from "styled-components";

const Flex = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const TabTitle = styled.span`
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

const TabIcon = styled.img`
  height: 14px;
`;

export default function Tab({ icon, title, url }: { icon: string; title: string; url: string }): JSX.Element {
  return (
    <Flex>
      <TabIcon src={icon} /> <TabTitle title={url}>{title}</TabTitle>
    </Flex>
  );
}

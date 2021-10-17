import React from "react";
import styled from "styled-components";

const Flex = styled.div`
  display: flex;
  flex-direction: row;
  gap: 8px;
`;

const TabTitle = styled.span`
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

export default function Tab({ icon, title }: { icon: string; title: string; url: string }): JSX.Element {
  return (
    <Flex>
      <span>{icon}</span> <TabTitle>{title}</TabTitle>
    </Flex>
  );
}

import React, { useState } from "react";
import styled from "styled-components";

const Group = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
`;

const TabsContainer = styled.ul`
  display: flex;
  flex-direction: row;
  gap: 4px;
  color: black;
  position: relative;

  &::before {
    content: " ";
    width: 100%;
    position: absolute;
    bottom: 0;
    left: 0;
    border-bottom: 1px solid black;
    z-index: 1;
  }
`;

const Tab = styled.li.attrs((props: { active: boolean }) => props)`
  list-style: none;
  cursor: pointer;
  background-color: ${({ active }) => (active ? "grey" : "#dedede")};
  padding: 10px;
  border-radius: 0.5rem 0.5rem 0 0;
`;

export default function Groups(): JSX.Element {
  const [active, setActive] = useState("google");
  const USER_TABS = ["google", "facebook", "email", "misc"];

  return (
    <Group>
      <TabsContainer>
        {USER_TABS.map((item) => (
          <Tab key={item + "-tab"} active={active === item} onClick={() => setActive(item)}>
            {item}
          </Tab>
        ))}
      </TabsContainer>
      <div>Links</div>
    </Group>
  );
}

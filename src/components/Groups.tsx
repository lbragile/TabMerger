import React from "react";
import styled from "styled-components";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { useSelector } from "../hooks/useSelector";
import { useDispatch } from "../hooks/useDispatch";
import { updateActiveContainer } from "../store/actions/groups";

const Group = styled.div`
  display: grid;
  grid-template-rows: 1fr 11fr;
  width: 90%;
  overflow: auto;
`;

const TabsContainer = styled.ul`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  color: black;
  position: relative;
`;

const Tab = styled.li.attrs((props: { active: boolean }) => props)`
  list-style: none;
  cursor: pointer;
  padding: 10px;
  background-color: ${({ active }) => (active ? "grey" : "#dedede")};
  border-radius: 0.5rem 0.5rem 0 0;
  width: 80px;
  text-align: center;
`;

const Links = styled.div`
  background-color: grey;
  padding: 1rem;
  border-radius: 0 8px 8px 8px;
`;

const AddIcon = styled(FontAwesomeIcon)`
  color: grey;
  margin: 0 0.5rem;
`;

export default function Groups(): JSX.Element {
  const dispatch = useDispatch();
  const { activeContainer } = useSelector((state) => state.group);

  const USER_TABS = ["google", "facebook", "email", "extension", "misc", "extra", "secret"];

  return (
    <Group>
      <TabsContainer>
        {USER_TABS.map((item) => (
          <Tab
            key={item + "-tab"}
            active={activeContainer === item}
            onClick={() => dispatch(updateActiveContainer(item))}
          >
            {item}
          </Tab>
        ))}

        <AddIcon icon={faPlus} />
      </TabsContainer>
      <Links>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
        <li>aaaaaaaaaaaaaaaaaaaaaaaaaaaa</li>
      </Links>
    </Group>
  );
}

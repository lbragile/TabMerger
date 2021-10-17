import React from "react";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Group from "./Group";

const Column = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  row-gap: 4px;
`;

const AddIcon = styled(FontAwesomeIcon)`
  margin-top: 8px;
  cursor: pointer;
  font-size: 20px;

  &:hover {
    color: rgb(0, 0, 0, 0.5);
  }
`;

export default function SidePanel(): JSX.Element {
  return (
    <Column>
      <Group name="Awaiting Storage" info={{ tab: "2T | 2W", when: "2 sec" }} color="#808080" permanent />
      <Group name="Duplicates" info={{ tab: "2T | 2W", when: "2 hours" }} color="#808080" permanent />
      <Group name="YouTube" info={{ tab: "4T | 1W", when: "1 day" }} color="#FF0000" />
      <Group name="GitHub" info={{ tab: "3T | 1W", when: "2 days" }} color="#FF8000" />
      <Group name="StackOverflow" info={{ tab: "6T | 1W", when: "1 week" }} color="#00FF00" />
      <Group name="Social" info={{ tab: "10T | 4W", when: "2 weeks" }} color="#0080FF" />
      <Group name="Other" info={{ tab: "3T | 2W", when: "1 month" }} color="#8000FF" />
      <Group name="Miscellaneous Junk From The Internet" info={{ tab: "3T | 1W", when: "1 year" }} color="#FF007F" />
      <AddIcon icon={faPlus} onClick={() => console.log("add group")} />
    </Column>
  );
}

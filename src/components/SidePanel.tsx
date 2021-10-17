import React from "react";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";
import Container from "./Container";

const Column = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  row-gap: 4px;
  position: absolute;
  left: 8px;
  top: 62px;
  max-height: 500px;
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
      <Container name="Awaiting Storage" info={{ tab: "2T | 2W", when: "2 sec" }} color="#808080" permanent />
      <Container name="Duplicates" info={{ tab: "2T | 2W", when: "2 hours" }} color="#808080" permanent />
      <Container name="YouTube" info={{ tab: "4T | 1W", when: "1 day" }} color="#FF0000" />
      <Container name="GitHub" info={{ tab: "3T | 1W", when: "2 days" }} color="#FF8000" />
      <Container name="StackOverflow" info={{ tab: "6T | 1W", when: "1 week" }} color="#00FF00" />
      <Container name="Social" info={{ tab: "10T | 4W", when: "2 weeks" }} color="#0080FF" />
      <Container name="Other" info={{ tab: "3T | 2W", when: "1 month" }} color="#8000FF" />
      <Container
        name="Miscellaneous Junk From The Internet"
        info={{ tab: "3T | 1W", when: "1 year" }}
        color="#FF007F"
      />
      <AddIcon icon={faPlus} onClick={() => console.log("add container")} />
    </Column>
  );
}

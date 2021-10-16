import React from "react";
import styled from "styled-components";
import { GlobalStyle } from "../styles/Global";
import Groups from "./Groups";

const Container = styled.div`
  width: 600px;
  height: 600px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
`;

export default function App(): JSX.Element {
  return (
    <Container>
      <GlobalStyle />
      <div>TabMerger</div>
      <Groups />
      <footer>Created By Lior Bragilevsky</footer>
    </Container>
  );
}

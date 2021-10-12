import React from "react";
import styled from "styled-components";
import { GlobalStyle } from "../styles/Global";
import Groups from "./Groups";

const Container = styled.div`
  width: 600px;
  height: 600px;
  display: flex;
  justify-content: center;
  align-items: center;
`;

export default function App(): JSX.Element {
  return (
    <Container>
      <GlobalStyle />
      <Groups />
    </Container>
  );
}

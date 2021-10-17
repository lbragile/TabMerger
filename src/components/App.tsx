import React from "react";
import styled from "styled-components";
import { GlobalStyle } from "../styles/Global";
import Header from "./Header";
import SidePanel from "./SidePanel";

const Wrapper = styled.div`
  width: 600px;
  height: 600px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  outline: 1px solid black;
  outline-offset: 1px;
`;

export default function App(): JSX.Element {
  return (
    <Wrapper>
      <GlobalStyle />
      <Header />
      <SidePanel />
    </Wrapper>
  );
}

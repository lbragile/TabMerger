import React, { useEffect } from "react";
import { useDispatch } from "react-redux";
import styled from "styled-components";
import { ACTIONS } from "../constants/backgroundActions";
import { updateWindows } from "../store/actions/groups";
import { GlobalStyle } from "../styles/Global";
import Header from "./Header";
import SidePanel from "./SidePanel";
import Windows from "./Windows";

const Container = styled.div`
  width: 600px;
  height: 600px;
  display: flex;
  flex-direction: column;
  align-items: center;
  outline: 1px solid black;
`;

const MainArea = styled.div`
  display: grid;
  grid-template-columns: 1fr 355px;
  column-gap: 20px;
  align-items: start;
  height: 524px;
  margin-top: 13px;
`;

export default function App(): JSX.Element {
  const dispatch = useDispatch();

  useEffect(() => {
    const fetchWindows = () => {
      chrome.runtime.sendMessage({ type: ACTIONS.GET_ALL_WINDOWS }, ({ data }) => {
        dispatch(updateWindows({ index: 0, windows: data }));
      });
    };

    fetchWindows(); // initial call without delay
    setInterval(fetchWindows, 1000);
  }, [dispatch]);

  return (
    <Container>
      <GlobalStyle />
      <Header />

      <MainArea>
        <SidePanel />

        <Windows />
      </MainArea>
    </Container>
  );
}

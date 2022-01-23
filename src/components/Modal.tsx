import styled from "styled-components";

import About from "../pages/About";
import Export from "../pages/Export";
import Import from "../pages/Import";
import Settings from "../pages/Settings";
import Sync from "../pages/Sync";

import { useDispatch, useSelector } from "~/hooks/useRedux";
import { setVisibility } from "~/store/actions/modal";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 500px;
  position: absolute;
  top: 32px;
  left: 230px;
  background: white;
  padding: 8px;
  box-shadow: 0 0 2px 2px #1113;
  z-index: 2;
`;

const Overlay = styled.div`
  width: 100vw;
  height: 100vh;
  background-color: #31313140;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1;
`;

export default function Modal(): JSX.Element {
  const dispatch = useDispatch();

  const { type } = useSelector((state) => state.modal);

  return (
    <>
      <Overlay onClick={() => dispatch(setVisibility(false))} role="presentation" />

      <Container>
        {type === "import" && <Import />}
        {type === "export" && <Export />}
        {type === "sync" && <Sync />}
        {type === "settings" && <Settings />}
        {type === "about" && <About />}
      </Container>
    </>
  );
}

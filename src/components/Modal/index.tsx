import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";

import About from "./About";
import Export from "./Export";
import Import from "./Import";
import Settings from "./Settings";

export type TModalType = "about" | "settings" | "import" | "export";

interface IModal {
  title: string;
  type: TModalType;
  setVisible: React.Dispatch<React.SetStateAction<boolean>>;
  save?: () => void;
}

const CloseIcon = styled(FontAwesomeIcon)`
  padding: 4px;
  cursor: pointer;

  & svg {
    color: black;
  }

  &:hover {
    background-color: lightgrey;
  }
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 400px;
  max-width: 500px;
  position: absolute;
  top: 25%;
  left: 230px;
  background: white;
  padding: 8px;
  box-shadow: 0 0 2px 2px #1113;
  z-index: 2;
`;

const Overlay = styled.div`
  width: 100vw;
  height: 100vh;
  background-color: #31313180;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1;
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

export default function Modal({ title, type, setVisible, save }: IModal): JSX.Element {
  const hide = () => setVisible(false);

  return (
    <>
      <Overlay onClick={hide} role="presentation" />
      <Container>
        <Row>
          <h3>{title}</h3>

          <CloseIcon
            icon="times"
            tabIndex={0}
            onClick={hide}
            onPointerDown={(e) => e.preventDefault()}
            onKeyPress={({ key }) => key === "Enter" && hide()}
          />
        </Row>

        {type === "about" && <About />}
        {type === "settings" && <Settings />}
        {type === "import" && <Import />}
        {type === "export" && <Export />}

        <Row>
          {save && <button onClick={save}>Save</button>}
          <button onClick={hide}>Cancel</button>
        </Row>
      </Container>
    </>
  );
}

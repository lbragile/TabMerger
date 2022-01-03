import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { saveAs } from "file-saver";
import { Dispatch, SetStateAction } from "react";
import styled from "styled-components";

import About from "./About";
import Export from "./Export";
import Import from "./Import";
import Settings from "./Settings";

import { useDispatch, useSelector } from "~/hooks/useRedux";
import GROUPS_CREATORS from "~/store/actions/groups";

const CloseIconContainer = styled.span`
  padding: 4px 8px;
  cursor: pointer;
  display: flex;

  &:hover {
    color: red;
    background-color: #ff000020;
  }
`;

const CloseIcon = styled(FontAwesomeIcon)`
  font-size: 16px;
`;

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

const HeaderRow = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const FooterRow = styled(HeaderRow)`
  gap: 8px;
  justify-content: end;
`;

const Button = styled.button<{ $primary?: boolean }>`
  border: none;
  outline: none;
  background-color: ${({ $primary }) => ($primary ? "#007bff" : "#e8e8e8")};
  color: ${({ $primary }) => ($primary ? "white" : "black")};
  padding: 4px;
  min-width: 75px;
  font-weight: bold;
  cursor: pointer;

  &:hover {
    background-color: ${({ $primary }) => ($primary ? "#0069d9" : "#e0e0e0")};
  }
`;

export interface IModal {
  setVisible: Dispatch<SetStateAction<boolean>>;
}

export default function Modal({ setVisible }: IModal): JSX.Element {
  const dispatch = useDispatch();

  const { available } = useSelector((state) => state.groups);

  const {
    info: { type, title, closeText, saveText },
    export: { file },
    import: { formatted }
  } = useSelector((state) => state.modal);

  const hide = () => setVisible(false);

  const handleSave = () => {
    if (type === "export" && file) {
      saveAs(file);
    } else if (type === "import") {
      dispatch(GROUPS_CREATORS.updateAvailable([available[0], ...formatted]));
      dispatch(GROUPS_CREATORS.updateActive({ index: 0, id: formatted[0].id }));
    }

    hide();
  };

  return (
    <>
      <Overlay onClick={hide} role="presentation" />

      <Container>
        <HeaderRow>
          <h3>{title}</h3>

          <CloseIconContainer
            tabIndex={0}
            role="button"
            onClick={hide}
            onPointerDown={(e) => e.preventDefault()}
            onKeyPress={({ key }) => key === "Enter" && hide()}
          >
            <CloseIcon icon="times" />
          </CloseIconContainer>
        </HeaderRow>

        {type === "about" && <About />}
        {type === "settings" && <Settings />}
        {type === "import" && <Import />}
        {type === "export" && <Export />}

        <FooterRow>
          {saveText && ((type === "export" && file) || (type === "import" && formatted.length > 0)) && (
            <Button onClick={handleSave} $primary>
              {saveText}
            </Button>
          )}

          <Button onClick={hide}>{closeText}</Button>
        </FooterRow>
      </Container>
    </>
  );
}

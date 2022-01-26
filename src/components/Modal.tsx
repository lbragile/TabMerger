import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, useRef, useEffect } from "react";
import styled from "styled-components";

import About from "../pages/About";
import Export from "../pages/Export";
import Import from "../pages/Import";
import Settings from "../pages/Settings";
import Sync from "../pages/Sync";

import { useDispatch, useSelector } from "~/hooks/useRedux";
import { setVisibility } from "~/store/actions/modal";
import Button from "~/styles/Button";

const HeaderRow = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const FooterRow = styled(HeaderRow)`
  justify-content: end;
  gap: 8px;
`;

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
  background: ${({ theme }) => theme.colors.background};
  padding: 8px;
  box-shadow: 0 0 2px 2px #1113;
  z-index: 2;
`;

const Overlay = styled.div`
  width: 100vw;
  height: 100vh;
  background-color: ${({ theme }) => theme.colors.onBackground};
  opacity: 0.2;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1;
`;

interface IModalFooter {
  closeText?: string;
  saveText?: string;
  showSave: boolean;
  handleSave?: () => void;
}

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

export function ModalHeader({ title }: { title: string }) {
  const dispatch = useDispatch();

  const hide = () => dispatch(setVisibility(false));

  return (
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
  );
}

export function ModalFooter({ closeText = "Close", saveText = "Save", showSave, handleSave }: IModalFooter) {
  const dispatch = useDispatch();

  const hide = () => dispatch(setVisibility(false));

  const [saveSuccess, setSaveSuccess] = useState(false);

  const timeoutRef = useRef<NodeJS.Timeout>();

  // Timeout need sto be cleared if the user closes the modal to avoid memory leaks
  useEffect(() => {
    const handleRemoveTimeout = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };

    handleRemoveTimeout();

    return () => handleRemoveTimeout();
  }, []);

  return (
    <FooterRow>
      {showSave && (
        <Button
          onClick={() => {
            try {
              handleSave?.();

              /**
               * Prevent user from mashing the submit button, as some cases have rate limits
               * @example @see https://developer.chrome.com/docs/extensions/reference/storage/#property-sync-sync-MAX_WRITE_OPERATIONS_PER_MINUTE
               */
              setSaveSuccess(true);
              timeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
            } catch (err) {
              setSaveSuccess(false);
            }
          }}
          $variant={saveSuccess ? "success" : "primary"}
          disabled={saveSuccess}
        >
          {saveSuccess ? <FontAwesomeIcon icon="check-circle" /> : saveText}
        </Button>
      )}

      <Button onClick={hide}>{closeText}</Button>
    </FooterRow>
  );
}

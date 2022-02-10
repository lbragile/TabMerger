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
import { ModalContainer, Overlay } from "~/styles/Modal";
import { Row } from "~/styles/Row";

const HeaderRow = styled(Row)`
  justify-content: space-between;
`;

const FooterRow = styled(HeaderRow)``;

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

interface IModalHeader {
  title: string;
  hideHandler?: () => void;
}
interface IModalFooter extends Omit<IModalHeader, "title"> {
  closeText?: string;
  saveText?: string;
  showSave: boolean;
  handleSave?: () => void;
  children?: JSX.Element;
}

export default function Modal(): JSX.Element {
  const dispatch = useDispatch();

  const { type } = useSelector((state) => state.modal);

  return (
    <>
      <Overlay onClick={() => dispatch(setVisibility(false))} role="presentation" />

      <ModalContainer>
        {type === "import" && <Import />}
        {type === "export" && <Export />}
        {type === "sync" && <Sync />}
        {type === "settings" && <Settings />}
        {type === "about" && <About />}
      </ModalContainer>
    </>
  );
}

export function ModalHeader({ title, hideHandler }: IModalHeader) {
  const dispatch = useDispatch();

  const hide = () => hideHandler?.() ?? dispatch(setVisibility(false));

  return (
    <HeaderRow>
      <h3>{title}</h3>

      <CloseIconContainer
        tabIndex={0}
        role="button"
        onClick={hide}
        onPointerDown={(e) => e.preventDefault()}
        onKeyPress={({ code }) => code === "Enter" && hide()}
      >
        <CloseIcon icon="times" />
      </CloseIconContainer>
    </HeaderRow>
  );
}

export function ModalFooter({
  closeText = "Close",
  saveText = "Save",
  showSave,
  handleSave,
  hideHandler,
  children
}: IModalFooter) {
  const dispatch = useDispatch();

  const hide = () => hideHandler?.() ?? dispatch(setVisibility(false));

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
      {children ?? <div />}

      <Row>
        <Button onClick={hide}>{closeText}</Button>

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
      </Row>
    </FooterRow>
  );
}

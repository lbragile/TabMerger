import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";

import Checkbox from "./Checkbox";
import { ModalHeader, ModalFooter } from "./Modal";
import Note from "./Note";

import useStorageWithSave from "~/hooks/useStorageWithSave";
import { Column } from "~/styles/Column";
import { ModalContainer, Overlay } from "~/styles/Modal";

const CenteredItems = styled(Column)`
  align-items: center;
`;

interface IDeleteConfirmation {
  isWindow: boolean;
  windowIndex: number;
  setShow: (arg: boolean) => void;
  closeHandler: () => void;
}

export default function DeleteConfirmation({
  isWindow,
  windowIndex,
  setShow,
  closeHandler
}: IDeleteConfirmation): JSX.Element {
  const [, setConfirmDelete, localConfirmDelete, setLocalConfirmDelete] = useStorageWithSave("confirmDelete", false);

  const hideHandler = () => setShow(false);

  return (
    <>
      <Overlay onClick={hideHandler} role="presentation" />

      <ModalContainer>
        <ModalHeader title="TabMerger Confirmation" hideHandler={hideHandler} />

        <CenteredItems>
          <FontAwesomeIcon icon="times-circle" size="4x" color="#dc3545" />

          <h1>Are you sure?</h1>
        </CenteredItems>

        <Note>
          {windowIndex > 0 ? (
            <p>This {isWindow ? "window" : "tab"} is currently open - even if it is not visible on your screen</p>
          ) : (
            <p>Closing {isWindow ? "" : "tabs in"} the &ldquo;Current Window&rdquo; might close TabMerger</p>
          )}

          <p>Consider storing in a group so that TabMerger can persist the information </p>
        </Note>

        <ModalFooter
          showSave
          closeText="Cancel"
          saveText="Continue"
          handleSave={() => {
            setConfirmDelete(localConfirmDelete);
            closeHandler();

            // In this case, want to close the modal right away
            hideHandler();
          }}
          hideHandler={hideHandler}
        >
          <Checkbox
            id="keepShowing"
            text="Show Again"
            checked={localConfirmDelete}
            setChecked={setLocalConfirmDelete}
          />
        </ModalFooter>
      </ModalContainer>
    </>
  );
}

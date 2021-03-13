import React from "react";
import { Modal, Button } from "react-bootstrap";
import { DialogConstantReturn } from "../../constants/constants";

export type setStateType<T> = React.Dispatch<React.SetStateAction<T>>;
export interface DialogProps extends DialogConstantReturn {
  setDialog: setStateType<{ show: boolean }>;
}

export default function Dialog({
  element,
  show,
  title,
  msg,
  reject_btn_text,
  accept_btn_text,
  setDialog,
}: DialogProps): JSX.Element {
  /**
   * Stores the response in localStorage when dialog is confirmation type
   *
   * @param {React.MouseEvent<HTMLButtonElement, MouseEvent>} e Button that was pressed in the dialog box
   */
  function saveConfirmAnswer(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
    if (reject_btn_text) {
      element.setAttribute("response", (e.target as HTMLButtonElement).value);
    }

    // need a delay to prevent disruption to mutation listener of element above
    setTimeout(() => setDialog({ show: false }), 100);
  }

  return (
    <Modal
      className="text-dark"
      show={show}
      backdrop="static"
      keyboard={false}
      animation={false}
      onHide={() => setDialog({ show: false })}
      centered
    >
      <Modal.Header style={{ backgroundColor: "#f7f7f7" }} closeButton={!!title?.match(/Question|Activation/i)}>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{msg}</Modal.Body>
      {accept_btn_text && (
        <Modal.Footer style={{ backgroundColor: "#f7f7f7" }}>
          <Button
            className="text-primary"
            variant="primary"
            value="positive"
            onClick={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>): void => saveConfirmAnswer(e)}
          >
            {accept_btn_text}
          </Button>

          {reject_btn_text && (
            <Button
              className="text-dark"
              variant="secondary"
              value="negative"
              onClick={(e: React.MouseEvent<HTMLButtonElement, MouseEvent>): void => saveConfirmAnswer(e)}
            >
              {reject_btn_text}
            </Button>
          )}
        </Modal.Footer>
      )}
    </Modal>
  );
}

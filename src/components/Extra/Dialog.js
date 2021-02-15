import React from "react";
import { Modal, Button } from "react-bootstrap";

export default function Dialog({ element, show, title, msg, reject_btn_text, accept_btn_text, setDialog }) {
  /**
   * Stores the response in localStorage when dialog is confirmation type
   *
   * @param {HTMLElement} e Button that was pressed in the dialog box
   */
  function saveConfirmAnswer(e) {
    if (reject_btn_text) {
      element.setAttribute("response", e.target.value);
    }

    // need a delay to prevent disruption to mutation listener of element above
    setTimeout(() => {
      setDialog({ show: false });
    }, 100);
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
      <Modal.Header style={{ backgroundColor: "#f7f7f7" }} closeButton={!!title?.includes("Question")}>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{msg}</Modal.Body>
      <Modal.Footer style={{ backgroundColor: "#f7f7f7" }}>
        <Button className="text-primary" variant="primary" value="positive" onClick={(e) => saveConfirmAnswer(e)}>
          {accept_btn_text}
        </Button>
        {reject_btn_text && (
          <Button className="text-dark" variant="secondary" value="negative" onClick={(e) => saveConfirmAnswer(e)}>
            {reject_btn_text}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

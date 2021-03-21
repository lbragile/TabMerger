/*
TabMerger as the name implies merges your tabs into one location to save
memory usage and increase your productivity.

Copyright (C) 2021  Lior Bragilevsky

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

If you have any questions, comments, or concerns you can contact the
TabMerger team at <https://lbragile.github.io/TabMerger-Extension/contact/>
*/

import React from "react";
import { Modal, Button } from "react-bootstrap";
import { DialogConstantReturn } from "@Typings/common";
import { setStateType } from "@Typings/common";

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

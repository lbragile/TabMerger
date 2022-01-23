import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import ModalFooter from "~/components/ModalFooter";
import { Note } from "~/styles/Note";

export default function Theme(): JSX.Element {
  return (
    <>
      <p>Dark/Light Mode with example</p>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>Visit the to adjust these keyboard shortcuts.</p>
          <p>Empty fields are not active!</p>
        </div>
      </Note>

      <ModalFooter showSave closeText="Close" />
    </>
  );
}

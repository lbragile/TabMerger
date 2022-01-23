import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import ModalFooter from "~/components/ModalFooter";
import { Note } from "~/styles/Note";

export default function Backup(): JSX.Element {
  return (
    <>
      <p>Automatic Export every X minutes to folder, keeping most recent Y backups</p>
      <p>Automatic Sync every X minutes</p>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>Visit the to adjust these keyboard shortcuts.</p>
          <p>Empty fields are not active!</p>
        </div>
      </Note>

      <ModalFooter showSave closeText="Cancel" />
    </>
  );
}

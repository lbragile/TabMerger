import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import { GOOGLE_HOMEPAGE } from "~/constants/urls";
import { useDebounce } from "~/hooks/useDebounce";
import useParseText from "~/hooks/useParseText";
import { Note } from "~/styles/Note";
import TextArea from "~/styles/Textarea";

interface IText {
  currentText: string;
  setCurrentText: (arg: string) => void;
}

export default function Text({ currentText, setCurrentText }: IText): JSX.Element {
  const debouncedCurrentText = useDebounce(currentText, 250);

  const { recomputeUploadType } = useParseText(debouncedCurrentText);

  return (
    <>
      <TextArea
        $height="300px"
        $background="initial"
        placeholder="Paste JSON, markdown, CSV, or plain text here..."
        value={currentText}
        onChange={({ target: { value } }) => {
          // If value changed due to a paste event, need to re-compute the upload type
          recomputeUploadType(value);

          setCurrentText(value);
        }}
      />

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <p>Each tab must have an associated URL (eg. {GOOGLE_HOMEPAGE})</p>
      </Note>
    </>
  );
}

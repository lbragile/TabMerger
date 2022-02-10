import type { IGroupItemState } from "~/store/reducers/groups";
import type { TImportType } from "~/typings/settings";

import Note from "~/components/Note";
import { GOOGLE_HOMEPAGE } from "~/constants/urls";
import { useDebounce } from "~/hooks/useDebounce";
import useParseText from "~/hooks/useParseText";
import TextArea from "~/styles/Textarea";

interface IText {
  currentText: string;
  setCurrentText: (arg: string) => void;
  importType: TImportType;
  setImportType: (arg: TImportType) => void;
  setImportFile: (arg: IGroupItemState[]) => void;
}

export default function Text({
  currentText,
  setCurrentText,
  importType,
  setImportType,
  setImportFile
}: IText): JSX.Element {
  const debouncedCurrentText = useDebounce(currentText, 250);

  useParseText({ debouncedText: debouncedCurrentText, importType, setImportFile });

  return (
    <>
      <TextArea
        $height="300px"
        placeholder="Paste JSON, markdown, CSV, or plain text here..."
        value={currentText}
        onChange={({ target: { value } }) => {
          // If value changed due to a paste event, need to re-compute the upload type
          let type: TImportType = "json";
          if (/.+?\n={3,}\n/.test(value)) type = "text";
          else if (/\n*#{2,3}.+?\n/.test(value)) type = "markdown";
          else if (/(".+?",?){4}\n/.test(value)) type = "csv";

          if (type !== importType) setImportType(type);

          setCurrentText(value);
        }}
      />

      <Note>
        <p>Each tab must have an associated URL (eg. {GOOGLE_HOMEPAGE})</p>
      </Note>
    </>
  );
}

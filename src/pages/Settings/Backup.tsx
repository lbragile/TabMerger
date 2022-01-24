import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import styled from "styled-components";

import Link from "~/components/Link";
import ModalFooter from "~/components/ModalFooter";
import { DOWNLOADS_URL } from "~/constants/urls";
import useLocalStorage from "~/hooks/useLocalStorage";
import { Message } from "~/styles/Message";
import { Note } from "~/styles/Note";
import { relativeTimeStr } from "~/utils/helper";

const Header = styled.h3`
  padding: 4px;
  background: #f0f0f0;
`;

const StyledInput = styled.input`
  all: unset;
  width: 8ch;
  border-bottom: 1px solid black;
  font-weight: bold;
  text-align: center;

  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    opacity: 1;
    cursor: pointer;
  }
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: start;
  align-items: center;
  padding: 8px;
`;

const CheckboxContainer = styled(Row)`
  padding: unset;
  gap: 8px;

  & label,
  & input {
    cursor: pointer;
  }
`;

const StyledMessage = styled(Message)<{ $error: boolean; $recent: boolean }>`
  background: ${({ $error, $recent }) => ($error ? "#ffdddd" : $recent ? "#ddffdd" : "#e8e8ff")};
  color: ${({ $error, $recent }) => ($error ? "#721c24" : $recent ? "#155724" : "blue")};
  width: fit-content;
  padding: 4px 8px;
`;

export default function Backup(): JSX.Element {
  const [autoExport, setAutoExport] = useLocalStorage("autoExport", false);
  const [exportFreq, setExportFreq] = useLocalStorage("exportFreq", 30);
  const [exportMax, setExportMax] = useLocalStorage("exportMax", 2);

  const [autoSync, setAutoSync] = useLocalStorage("autoSync", false);
  const [syncFreq, setSyncFreq] = useLocalStorage("syncFreq", 30);

  const [lastSyncUpload] = useLocalStorage("lastSyncUpload", "");

  const relativeTime = relativeTimeStr(new Date(lastSyncUpload).getTime());

  return (
    <>
      <Header>Automatic Export</Header>

      <StyledMessage $error={lastSyncUpload === ""} $recent={relativeTime.includes("<")}>
        {lastSyncUpload === ""
          ? `Nothing was exported... yet`
          : `Last exported on ${lastSyncUpload} (${relativeTime} ago)`}
      </StyledMessage>

      <CheckboxContainer>
        <input
          type="checkbox"
          id="autoExport"
          name="autoExport"
          checked={autoExport}
          onChange={() => setAutoExport(!autoExport)}
        />
        <label htmlFor="autoExport">Enable Automatic Export</label>
      </CheckboxContainer>

      <div>
        <span>Every</span>{" "}
        <StyledInput
          type="number"
          step="1"
          min="1"
          max="1440"
          value={exportFreq}
          onChange={({ target: { value } }) => setExportFreq(Math.max(1, Math.min(Math.round(Number(value)), 1440)))}
        />{" "}
        <span>minutes</span>
      </div>

      <div>
        <span>Keeping</span>{" "}
        <StyledInput
          type="number"
          step="1"
          min="1"
          max="10"
          value={exportMax}
          onChange={({ target: { value } }) => setExportMax(Math.max(1, Math.min(Math.round(Number(value)), 10)))}
        />{" "}
        <span>most recent</span>
      </div>

      <Header>Automatic Sync</Header>

      <StyledMessage $error={lastSyncUpload === ""} $recent={relativeTime.includes("<")}>
        {lastSyncUpload === "" ? `Nothing was synced... yet` : `Last synced on ${lastSyncUpload} (${relativeTime} ago)`}
      </StyledMessage>

      <CheckboxContainer>
        <input
          type="checkbox"
          id="autoSync"
          name="autoSync"
          checked={autoSync}
          onChange={() => setAutoSync(!autoSync)}
        />
        <label htmlFor="autoSync">Enable Automatic Sync</label>
      </CheckboxContainer>

      <div>
        <span>Every</span>{" "}
        <StyledInput
          type="number"
          step="1"
          min="1"
          max="1440"
          value={syncFreq}
          onChange={({ target: { value } }) => setSyncFreq(Math.max(1, Math.min(Math.round(Number(value)), 1440)))}
        />{" "}
        <span>minutes</span>
      </div>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>These happen in the background - even when TabMerger is closed!</p>
          <span>Files are saved to your</span> <Link href={DOWNLOADS_URL} title="Downloads Folder" />{" "}
          <span>in JSON format</span>
        </div>
      </Note>
      <ModalFooter showSave closeText="Cancel" />
    </>
  );
}

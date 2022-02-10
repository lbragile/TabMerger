import styled from "styled-components";

import Checkbox from "~/components/Checkbox";
import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import Note from "~/components/Note";
import { DOWNLOADS_URL } from "~/constants/urls";
import useLocalStorage from "~/hooks/useLocalStorage";
import useStorageWithSave from "~/hooks/useStorageWithSave";
import { Message } from "~/styles/Message";
import { SectionTitle } from "~/styles/SectionTitle";
import { pluralize, relativeTimeStr } from "~/utils/helper";

const StyledInput = styled.input`
  all: unset;
  width: 8ch;
  border-bottom: 1px solid ${({ theme }) => theme.colors.onBackground};
  font-weight: bold;
  text-align: center;

  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    opacity: 1;
    cursor: pointer;
  }
`;

const StyledMessage = styled(Message)`
  margin: unset;
`;

export default function Backup(): JSX.Element {
  const [, setAutoExport, localAutoExport, setLocalAutoExport] = useStorageWithSave("autoExport", false);
  const [, setExportFreq, localExportFreq, setLocalExportFreq] = useStorageWithSave("exportFreq", 10);
  const [, setExportMax, localExportMax, setLocalExportMax] = useStorageWithSave("exportMax", 2);
  const [, setAutoSync, localAutoSync, setLocalAutoSync] = useStorageWithSave("autoSync", false);
  const [, setSyncFreq, localSyncFreq, setLocalSyncFreq] = useStorageWithSave("syncFreq", 10);

  const [lastSyncUpload] = useLocalStorage("lastSyncUpload", "");
  const [lastExport] = useLocalStorage("lastExport", "");

  const [relativeTimeExport, relativeTimeSync] = [lastExport, lastSyncUpload].map((item) =>
    relativeTimeStr(new Date(item).getTime())
  );

  return (
    <>
      <SectionTitle>Automatic Export</SectionTitle>

      <StyledMessage $error={lastExport === ""} $recent={relativeTimeExport.includes("<")}>
        {lastExport === ""
          ? `Nothing was exported... yet`
          : `Last exported on ${lastExport} (${relativeTimeExport} ago)`}
      </StyledMessage>

      <Checkbox
        id="autoExport"
        text="Automatically Export"
        checked={localAutoExport}
        setChecked={() => setLocalAutoExport(!localAutoExport)}
      />

      <div>
        <span>Every</span>{" "}
        <StyledInput
          type="number"
          step="1"
          min="1"
          max="30"
          value={localExportFreq}
          onChange={({ target: { valueAsNumber } }) => setLocalExportFreq(valueAsNumber)}
          onBlur={({ target: { valueAsNumber } }) => setLocalExportFreq(Math.max(1, Math.min(valueAsNumber, 30)))}
        />{" "}
        <span>{pluralize(localExportFreq, "minute")}</span>
      </div>

      <div>
        <span>Keeping</span>{" "}
        <StyledInput
          type="number"
          step="1"
          min="1"
          max="10"
          value={localExportMax}
          onChange={({ target: { valueAsNumber } }) => setLocalExportMax(valueAsNumber)}
          onBlur={({ target: { valueAsNumber } }) => setLocalExportMax(Math.max(1, Math.min(valueAsNumber, 10)))}
        />{" "}
        <span>most recent</span>
      </div>

      <SectionTitle>Automatic Sync</SectionTitle>

      <StyledMessage $error={lastSyncUpload === ""} $recent={relativeTimeSync.includes("<")}>
        {lastSyncUpload === ""
          ? `Nothing was synced... yet`
          : `Last synced on ${lastSyncUpload} (${relativeTimeSync} ago)`}
      </StyledMessage>

      <Checkbox
        id="autoSync"
        text="Automatically Sync"
        checked={localAutoSync}
        setChecked={() => setLocalAutoSync(!localAutoSync)}
      />

      <div>
        <span>Every</span>{" "}
        <StyledInput
          type="number"
          step="1"
          min="1"
          max="30"
          value={localSyncFreq}
          onChange={({ target: { valueAsNumber } }) => setLocalSyncFreq(valueAsNumber)}
          onBlur={({ target: { valueAsNumber } }) => setLocalSyncFreq(Math.max(1, Math.min(valueAsNumber, 30)))}
        />{" "}
        <span>{pluralize(localSyncFreq, "minute")}</span>
      </div>

      <Note>
        <p>These happen in the background - even when TabMerger is closed!</p>

        <span>
          Files are saved to your <Link href={DOWNLOADS_URL} title="Downloads Folder" /> in JSON format
        </span>
      </Note>

      <ModalFooter
        showSave
        closeText="Cancel"
        handleSave={() => {
          setAutoExport(localAutoExport);
          setExportFreq(localExportFreq);
          setExportMax(localExportMax);

          setAutoSync(localAutoSync);
          setSyncFreq(localSyncFreq);
        }}
      />
    </>
  );
}

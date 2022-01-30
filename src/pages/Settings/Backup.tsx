import { useEffect, useState } from "react";
import styled from "styled-components";

import Checkbox from "~/components/Checkbox";
import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import Note from "~/components/Note";
import { DOWNLOADS_URL } from "~/constants/urls";
import useLocalStorage from "~/hooks/useLocalStorage";
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
  const [autoExport, setAutoExport] = useLocalStorage("autoExport", false);
  const [exportFreq, setExportFreq] = useLocalStorage("exportFreq", 10);
  const [exportMax, setExportMax] = useLocalStorage("exportMax", 2);
  const [autoSync, setAutoSync] = useLocalStorage("autoSync", false);
  const [syncFreq, setSyncFreq] = useLocalStorage("syncFreq", 10);

  const [lastSyncUpload] = useLocalStorage("lastSyncUpload", "");
  const [lastExport] = useLocalStorage("lastExport", "");

  const [localAutoExport, setLocalAutoExport] = useState(autoExport);
  const [localExportFreq, setLocalExportFreq] = useState(exportFreq);
  const [localExportMax, setLocalExportMax] = useState(exportMax);
  const [localAutoSync, setLocalAutoSync] = useState(autoSync);
  const [localSyncFreq, setLocalSyncFreq] = useState(syncFreq);

  const [relativeTimeExport, relativeTimeSync] = [lastExport, lastSyncUpload].map((item) =>
    relativeTimeStr(new Date(item).getTime())
  );

  useEffect(() => setLocalAutoExport(autoExport), [autoExport]);
  useEffect(() => setLocalExportFreq(exportFreq), [exportFreq]);
  useEffect(() => setLocalExportMax(exportMax), [exportMax]);
  useEffect(() => setLocalAutoSync(autoSync), [autoSync]);
  useEffect(() => setLocalSyncFreq(syncFreq), [syncFreq]);

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
        text="Enable Automatic Export"
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
        text="Enable Automatic Sync"
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

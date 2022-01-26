import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import styled from "styled-components";

import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import { DOWNLOADS_URL } from "~/constants/urls";
import useLocalStorage from "~/hooks/useLocalStorage";
import { Message } from "~/styles/Message";
import { Note } from "~/styles/Note";
import { SectionTitle } from "~/styles/SectionTitle";
import { pluralize, relativeTimeStr } from "~/utils/helper";

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

      <CheckboxContainer>
        <input
          type="checkbox"
          id="autoExport"
          name="autoExport"
          checked={localAutoExport}
          onChange={() => setLocalAutoExport(!localAutoExport)}
        />
        <label htmlFor="autoExport">Enable Automatic Export</label>
      </CheckboxContainer>

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

      <CheckboxContainer>
        <input
          type="checkbox"
          id="autoSync"
          name="autoSync"
          checked={localAutoSync}
          onChange={() => setLocalAutoSync(!localAutoSync)}
        />
        <label htmlFor="autoSync">Enable Automatic Sync</label>
      </CheckboxContainer>

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
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>These happen in the background - even when TabMerger is closed!</p>
          <span>Files are saved to your</span> <Link href={DOWNLOADS_URL} title="Downloads Folder" />{" "}
          <span>in JSON format</span>
        </div>
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

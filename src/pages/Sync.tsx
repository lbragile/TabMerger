import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import styled from "styled-components";

import { ModalFooter, ModalHeader } from "~/components/Modal";
import Selector from "~/components/Selector";
import { MAX_SYNC_TABS_PER_GROUP, MAX_SYNC_GROUPS } from "~/constants/sync";
import useFormatText from "~/hooks/useFormatText";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useSelector } from "~/hooks/useRedux";
import useSyncStorageInfo, { useSyncStorageDownload, useSyncStorageUpload } from "~/hooks/useSyncStorage";
import Button from "~/styles/Button";
import { Message } from "~/styles/Message";
import { Note } from "~/styles/Note";
import TextArea from "~/styles/Textarea";
import { TSyncType } from "~/typings/settings";
import { relativeTimeStr } from "~/utils/helper";

const StyledMessage = styled(Message)<{ $error: boolean; $recent: boolean }>`
  background: ${({ $error, $recent }) => ($error ? "#ffdddd" : $recent ? "#ddffdd" : "#e8e8ff")};
  color: ${({ $error, $recent }) => ($error ? "#721c24" : $recent ? "#155724" : "blue")};
  width: fit-content;
  padding: 4px 8px;
  margin: auto;
`;

const StyledButton = styled(Button)`
  margin: auto;
`;

export default function Sync(): JSX.Element {
  const { available } = useSelector((state) => state.groups);

  const [fileLocationPicker] = useLocalStorage("fileLocationPicker", false);

  const [activeTab, setActiveTab] = useState<TSyncType>("Upload");

  const { possibleData, currentData } = useSyncStorageInfo(activeTab, available);

  const syncAmount = (activeTab === "Upload" ? possibleData : currentData).length;

  const { getRegularText: getRegularTextPossible, getHTMLText: getHTMLTextPossible } = useFormatText(possibleData);
  const { getRegularText: getRegularTextCurrent, getHTMLText: getHTMLTextCurrent } = useFormatText(currentData);

  const syncUpload = useSyncStorageUpload(possibleData);
  const syncDownload = useSyncStorageDownload(currentData, available);

  const [lastSyncUpload] = useLocalStorage("lastSyncUpload", "");
  const [lastSyncDownload] = useLocalStorage("lastSyncDownload", "");
  const activeLastSync = activeTab === "Upload" ? lastSyncUpload : lastSyncDownload;
  const relativeTime = relativeTimeStr(new Date(activeLastSync).getTime());

  const handlePreviewSyncData = () => {
    const data = [activeTab === "Upload" ? getHTMLTextPossible() : getHTMLTextCurrent()];
    const filename = `TabMerger Sync Preview.html`;
    const file = new File(data, filename, { type: "text/html" });

    const url = URL.createObjectURL(file);

    chrome.downloads.download({ conflictAction: "uniquify", saveAs: fileLocationPicker, filename, url }, () => "");
  };

  return (
    <>
      <ModalHeader title="TabMerger Sync" />

      <Selector opts={["Upload", "Download"]} activeTab={activeTab} setActiveTab={setActiveTab} />

      <StyledMessage $error={activeLastSync === ""} $recent={relativeTime.includes("<")}>
        {activeLastSync === ""
          ? `Nothing was ${activeTab.toLowerCase()}ed... yet`
          : `Last ${activeTab.toLowerCase()}ed on ${activeLastSync} (${relativeTime} ago)`}
      </StyledMessage>

      <TextArea
        value={activeTab === "Upload" ? getRegularTextPossible() : getRegularTextCurrent()}
        placeholder={`There is nothing to see here yet.\nYou must first upload something to be able to download!`}
        readOnly
      />

      <StyledButton $variant="info" disabled={syncAmount === 0} onClick={handlePreviewSyncData}>
        Preview
      </StyledButton>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          {activeTab === "Upload" ? (
            <p>
              Sync includes the first <b>{MAX_SYNC_TABS_PER_GROUP}</b> tabs per group for the first{" "}
              <b>{MAX_SYNC_GROUPS}</b> groups
            </p>
          ) : (
            <p>
              Press &ldquo;Download Sync&rdquo; to <b>replace</b> current data with the synced data!
            </p>
          )}
        </div>
      </Note>

      <ModalFooter
        showSave={syncAmount > 0}
        saveText={`${activeTab} Sync (${syncAmount})`}
        handleSave={() => {
          if (possibleData.length) syncUpload();
          else if (currentData.length) syncDownload();
        }}
      />
    </>
  );
}

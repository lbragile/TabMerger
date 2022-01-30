import { useState } from "react";
import styled from "styled-components";

import { ModalFooter, ModalHeader } from "~/components/Modal";
import Note from "~/components/Note";
import Selector from "~/components/Selector";
import { MAX_SYNC_TABS_PER_GROUP, MAX_SYNC_GROUPS } from "~/constants/sync";
import useFormatText from "~/hooks/useFormatText";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useSelector } from "~/hooks/useRedux";
import useSyncStorageInfo, { useSyncStorageDownload, useSyncStorageUpload } from "~/hooks/useSyncStorage";
import Button from "~/styles/Button";
import { Message } from "~/styles/Message";
import TextArea from "~/styles/Textarea";
import { TSyncType } from "~/typings/settings";
import { relativeTimeStr } from "~/utils/helper";

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

      <Message $error={activeLastSync === ""} $recent={relativeTime.includes("<")}>
        {activeLastSync === ""
          ? `Nothing was ${activeTab.toLowerCase()}ed... yet`
          : `Last ${activeTab.toLowerCase()}ed on ${activeLastSync} (${relativeTime} ago)`}
      </Message>

      <TextArea
        value={activeTab === "Upload" ? getRegularTextPossible() : getRegularTextCurrent()}
        placeholder={`There is nothing to see here yet.\nYou must first upload something to be able to download!`}
        readOnly
      />

      <StyledButton $variant="info" disabled={syncAmount === 0} onClick={handlePreviewSyncData}>
        Preview
      </StyledButton>

      <Note>
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

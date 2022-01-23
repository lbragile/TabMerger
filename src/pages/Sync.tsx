import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { saveAs } from "file-saver";
import { useState } from "react";
import styled from "styled-components";

import ModalFooter from "~/components/ModalFooter";
import ModalHeader from "~/components/ModalHeader";
import Selector from "~/components/Selector";
import { MAX_SYNC_TABS_PER_GROUP, MAX_SYNC_GROUPS } from "~/constants/sync";
import useFormatText from "~/hooks/useFormatText";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useSelector } from "~/hooks/useRedux";
import useSyncStorageInfo, { useSyncStorageDownload, useSyncStorageUpload } from "~/hooks/useSyncStorage";
import { TSyncType } from "~/store/reducers/modal";
import Button from "~/styles/Button";
import { Message } from "~/styles/Message";
import { Note } from "~/styles/Note";
import TextArea from "~/styles/Textarea";
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
  const [activeTab, setActiveTab] = useState<TSyncType>("Upload");
  const [disableSubmit, setDisableSubmit] = useState(false);

  const {
    sync: { currentData, possibleData }
  } = useSelector((state) => state.modal);

  const { available } = useSelector((state) => state.groups);

  const syncAmount = (activeTab === "Upload" ? possibleData : currentData).length;

  const { getRegularText: getRegularTextPossible, getHTMLText: getHTMLTextPossible } = useFormatText(possibleData);
  const { getRegularText: getRegularTextCurrent, getHTMLText: getHTMLTextCurrent } = useFormatText(currentData);

  const syncUpload = useSyncStorageUpload(possibleData);
  const syncDownload = useSyncStorageDownload(currentData, available);

  useSyncStorageInfo(activeTab, available);

  const [lastSyncUpload] = useLocalStorage("lastSyncUpload", "");
  const [lastSyncDownload] = useLocalStorage("lastSyncDownload", "");
  const activeLastSync = activeTab === "Upload" ? lastSyncUpload : lastSyncDownload;
  const relativeTime = relativeTimeStr(new Date(activeLastSync).getTime());

  const handlePreviewSyncData = () => {
    const data = [activeTab === "Upload" ? getHTMLTextPossible() : getHTMLTextCurrent()];
    const fileName = `TabMerger Sync - ${new Date().toTimeString()}.html`;
    const file = new File(data, fileName, { type: "text/html" });

    saveAs(file);
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
        disableSave={disableSubmit}
        handleSave={() => {
          if (possibleData.length) syncUpload();
          else if (currentData.length) syncDownload();

          /**
           * Prevent user from mashing the submit button, due to rate limit on sync storage
           * @see https://developer.chrome.com/docs/extensions/reference/storage/#property-sync-sync-MAX_WRITE_OPERATIONS_PER_MINUTE
           */
          setDisableSubmit(true);
          setTimeout(() => setDisableSubmit(false), 3000);
        }}
      />
    </>
  );
}

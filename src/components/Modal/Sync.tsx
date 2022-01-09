import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { saveAs } from "file-saver";
import { useState } from "react";
import styled from "styled-components";

import Selector from "./Selector";

import useFormatText from "~/hooks/useFormatText";
import { useSelector } from "~/hooks/useRedux";
import useSync from "~/hooks/useSync";
import Button from "~/styles/Button";
import Message from "~/styles/Message";
import { Note } from "~/styles/Note";
import TextArea from "~/styles/Textarea";

const StyledMessage = styled(Message)<{ $error: boolean }>`
  background: ${({ $error }) => ($error ? "#ffcccc" : "#ccffcc")};
  width: fit-content;
  padding: 4px 8px;
  margin: auto;
`;

export default function Sync(): JSX.Element {
  const [activeTab, setActiveTab] = useState<"Upload" | "Download">("Upload");

  const {
    sync: { last: lastSync, currentData, possibleData }
  } = useSelector((state) => state.modal);

  const { available } = useSelector((state) => state.groups);

  const { getRegularText: getRegularTextPossible, getHTMLText: getHTMLTextPossible } = useFormatText(possibleData);
  const { getRegularText: getRegularTextCurrent, getHTMLText: getHTMLTextCurrent } = useFormatText(currentData);

  const { MAX_SYNC_GROUPS, MAX_SYNC_TABS_PER_GROUP } = useSync(activeTab, available);

  const handlePreviewSyncData = () => {
    const data = [activeTab === "Upload" ? getHTMLTextPossible() : getHTMLTextCurrent()];
    const fileName = `TabMerger Sync - ${new Date().toTimeString()}.html`;
    const file = new File(data, fileName, { type: "text/html" });

    saveAs(file);
  };

  return (
    <>
      <Selector opts={["Upload", "Download"]} activeTab={activeTab} setActiveTab={setActiveTab} />

      <StyledMessage $error={lastSync === ""}>
        {lastSync === ""
          ? `Nothing was ${activeTab === "Upload" ? "uploaded" : "downloaded"}... yet`
          : `Last ${activeTab === "Upload" ? "uploaded" : "downloaded"} on ${lastSync.replace("Updated ", "")}`}
      </StyledMessage>

      <TextArea value={activeTab === "Upload" ? getRegularTextPossible() : getRegularTextCurrent()} readOnly />

      <Button $primary onClick={handlePreviewSyncData}>
        Preview
      </Button>

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
    </>
  );
}

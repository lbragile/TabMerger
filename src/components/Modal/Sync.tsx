import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { saveAs } from "file-saver";
import { useEffect, useState } from "react";
import styled from "styled-components";

import Selector from "./Selector";

import useFormatText from "~/hooks/useFormatText";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import MODAL_CREATORS from "~/store/actions/modal";
import { ISyncDataItem } from "~/store/reducers/modal";
import Button from "~/styles/Button";
import { Note } from "~/styles/Note";

const StyledTextArea = styled.textarea`
  height: 200px;
  width: 400px;
  border: 1px solid lightgray;
  background-color: #fafafa;
  border-radius: 0;
  padding: 8px;
  resize: none;
  margin: auto;
  white-space: pre;
  overflow-wrap: normal;
`;

const MAX_SYNC_GROUPS = 40;
const MAX_SYNC_TABS_PER_GROUP = 25;

export default function Sync(): JSX.Element {
  const dispatch = useDispatch();

  const [activeTab, setActiveTab] = useState<"Upload" | "Download">("Upload");

  const {
    sync: { last: lastSync, currentData, possibleData }
  } = useSelector((state) => state.modal);

  const { available } = useSelector((state) => state.groups);

  const { getHTMLText: getHTMLTextPossible } = useFormatText(possibleData, true, true);
  const { getHTMLText: getHTMLTextCurrent } = useFormatText(currentData, true, true);

  useEffect(() => {
    if (activeTab === "Download") {
      chrome.storage.sync.get(null, (groups) => {
        const groupsArr: (ISyncDataItem & { order?: number })[] = Object.values(groups);
        if (!groupsArr.length) return;

        const sortedGroupsArr = groupsArr.sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));

        dispatch(
          MODAL_CREATORS.updateSyncCurrentData(
            sortedGroupsArr.map((g) => {
              g.order = undefined;

              return g;
            })
          )
        );
        dispatch(MODAL_CREATORS.updateSyncPossibleData([]));
      });
    } else {
      const syncedGroups: ISyncDataItem[] = [];

      // Only sync stored groups (index > 1)
      const storedGroups = available.slice(1);
      for (let i = 0; i < Math.min(storedGroups.length, MAX_SYNC_GROUPS); i++) {
        syncedGroups.push({ name: storedGroups[i].name, color: storedGroups[i].color, windows: [] });

        let tabCount = 0;
        const currentWindows = storedGroups[i].windows;
        for (let j = 0; j < currentWindows.length; j++) {
          const windowTabs = currentWindows[j].tabs;
          if (!windowTabs) continue;
          if (tabCount > MAX_SYNC_TABS_PER_GROUP) break;

          const numTabsInWindow = windowTabs.length;
          let newTabs: chrome.tabs.Tab[] = [];
          if (tabCount + numTabsInWindow > MAX_SYNC_TABS_PER_GROUP) {
            const numTabsToAdd = MAX_SYNC_TABS_PER_GROUP - tabCount;
            newTabs = windowTabs.slice(0, numTabsToAdd);
          } else {
            newTabs = currentWindows[j].tabs ?? [];
          }

          tabCount += numTabsInWindow;

          /**
           * Need to strip some unnecessary information which can be large in some cases to maximize tabs per sync item
           * @example tab.favIconUrl can be a very long string, but it can be reconstructed from the tab.url
           */
          const { incognito, starred } = currentWindows[j];
          syncedGroups[i].windows.push({
            incognito,
            starred,
            tabs: newTabs.map(({ title, url }) => ({ title, url: url?.split("?")[0] }))
          });
        }
      }

      dispatch(MODAL_CREATORS.updateSyncPossibleData(syncedGroups));
      dispatch(MODAL_CREATORS.updateSyncCurrentData([]));
    }
  }, [dispatch, activeTab, available]);

  const handlePreviewSyncData = () => {
    const data = [activeTab === "Upload" ? getHTMLTextPossible() : getHTMLTextCurrent()];
    const fileName = `TabMerger Sync - ${new Date().toTimeString()}.html`;
    const file = new File(data, fileName, { type: "text/html" });

    saveAs(file);
  };

  return (
    <>
      <Selector opts={["Upload", "Download"]} activeTab={activeTab} setActiveTab={setActiveTab} />

      <>
        <p>Last Synced: {lastSync}</p>

        <h2>{activeTab === "Upload" ? "To Be Synced" : "Synced"}</h2>
        <StyledTextArea value={JSON.stringify(activeTab === "Upload" ? possibleData : currentData, null, 4)} readOnly />

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
    </>
  );
}

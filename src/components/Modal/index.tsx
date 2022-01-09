import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";
import { Dispatch, SetStateAction } from "react";
import styled from "styled-components";

import About from "./About";
import Export from "./Export";
import Import from "./Import";
import Settings from "./Settings";
import Sync from "./Sync";

import { useDispatch, useSelector } from "~/hooks/useRedux";
import GROUPS_CREATORS from "~/store/actions/groups";
import MODAL_CREATORS from "~/store/actions/modal";
import Button from "~/styles/Button";
import { createGroup, createTabFromTitleAndUrl, createWindowWithTabs, getReadableTimestamp } from "~/utils/helper";

const CloseIconContainer = styled.span`
  padding: 4px 8px;
  cursor: pointer;
  display: flex;

  &:hover {
    color: red;
    background-color: #ff000020;
  }
`;

const CloseIcon = styled(FontAwesomeIcon)`
  font-size: 16px;
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 500px;
  position: absolute;
  top: 32px;
  left: 230px;
  background: white;
  padding: 8px;
  box-shadow: 0 0 2px 2px #1113;
  z-index: 2;
`;

const Overlay = styled.div`
  width: 100vw;
  height: 100vh;
  background-color: #31313140;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1;
`;

const HeaderRow = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const FooterRow = styled(HeaderRow)`
  gap: 8px;
  justify-content: end;
`;

export interface IModal {
  setVisible: Dispatch<SetStateAction<boolean>>;
}

export default function Modal({ setVisible }: IModal): JSX.Element {
  const dispatch = useDispatch();

  const { available } = useSelector((state) => state.groups);

  const {
    info: { type, title, closeText, saveText },
    export: { file },
    import: { formatted },
    sync: { possibleData, currentData }
  } = useSelector((state) => state.modal);

  const hide = () => setVisible(false);

  const handleSave = () => {
    if (type === "export" && file) {
      saveAs(file);
    } else if (type === "import") {
      dispatch(GROUPS_CREATORS.updateAvailable([available[0], ...formatted]));
      dispatch(GROUPS_CREATORS.updateActive({ index: 0, id: formatted[0].id }));
    } else if (type === "sync") {
      if (possibleData.length) {
        chrome.storage.sync.clear();

        for (let i = 0; i < possibleData.length; i++) {
          const group = possibleData[i];
          const currentSize = group.name.length + JSON.stringify(group).length;
          if (currentSize <= 2500) {
            chrome.storage.sync.set({ [group.name + i]: { ...group, order: i } }, () => "");
          }
        }
      } else if (currentData.length) {
        // Create groups that are properly formatted using the limited sync data
        const newAvailable = currentData.map((item) => {
          const group = createGroup(nanoid(10), item.name, item.color);
          item.windows.forEach((w) => {
            const tabs: chrome.tabs.Tab[] = [];

            w.tabs.forEach((t) => {
              tabs.push(createTabFromTitleAndUrl(t.title, t.url));
            });

            group.windows.push(createWindowWithTabs(tabs, w.incognito, w.starred));
          });

          return group;
        });

        dispatch(GROUPS_CREATORS.updateAvailable([available[0], ...newAvailable]));
      }

      dispatch(MODAL_CREATORS.updateSyncLast(getReadableTimestamp(Date.now())));
    }

    hide();
  };

  return (
    <>
      <Overlay onClick={hide} role="presentation" />

      <Container>
        <HeaderRow>
          <h3>{title}</h3>

          <CloseIconContainer
            tabIndex={0}
            role="button"
            onClick={hide}
            onPointerDown={(e) => e.preventDefault()}
            onKeyPress={({ key }) => key === "Enter" && hide()}
          >
            <CloseIcon icon="times" />
          </CloseIconContainer>
        </HeaderRow>

        {type === "import" && <Import />}
        {type === "export" && <Export />}
        {type === "sync" && <Sync />}
        {type === "settings" && <Settings />}
        {type === "about" && <About />}

        <FooterRow>
          {saveText && type === "export" && file && (
            <Button onClick={handleSave} $primary>
              {saveText}
            </Button>
          )}

          {saveText && type === "import" && formatted.length > 0 && (
            <Button onClick={handleSave} $primary>
              {saveText + (type === "import" ? ` (${formatted.length})` : "")}
            </Button>
          )}

          {saveText && type === "sync" && (possibleData.length > 0 || currentData.length > 0) && (
            <Button onClick={handleSave} $primary>
              {`${possibleData.length > 0 ? "Upload" : "Download"} ${saveText}`}
            </Button>
          )}

          <Button onClick={hide}>{closeText}</Button>
        </FooterRow>
      </Container>
    </>
  );
}

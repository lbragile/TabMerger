import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import ColorPicker from "../ColorPicker";

import Link from "./Link";
import Selector from "./Selector";

import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE } from "~/constants/defaults";
import { CHROME_SHORTCUTS } from "~/constants/urls";
import useClickOutside from "~/hooks/useClickOutside";
import { useDebounce } from "~/hooks/useDebounce";
import useLocalStorage from "~/hooks/useLocalStorage";
import Message from "~/styles/Message";
import { Note } from "~/styles/Note";

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

const ShortcutGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  border: 1px solid grey;
  padding: 8px;
  row-gap: 16px;
`;

const ShortcutItem = styled.div<{ $disabled: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;

  & span {
    width: fit-content;
    min-width: 40px;
    height: 24px;
    text-align: center;
    border: 1px solid #ccc;
    padding: 0.1em 0.5em;
    margin: 0 0.2em;
    box-shadow: 0 1px 0 #0002, 0 0 0 2px #fff inset;
    background-color: #f7f7f7;
  }

  ${({ $disabled }) =>
    $disabled &&
    css`
      opacity: 0.5;
    `}
`;

const GroupButton = styled.div`
  width: 209px;
  height: 49px;
  background-color: white;
  outline: 1px solid rgb(0 0 0 / 10%);
  outline-offset: -1px;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px 8px 2px 16px;
  cursor: pointer;
`;

const Headline = styled.input`
  all: unset;
  font-size: 16px;
  font-weight: 600;
  width: fit-content;
  max-width: 95%;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  line-height: 16px;

  &:hover {
    border-bottom: 1px solid grey;
  }
`;

const Information = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  width: 100%;
  font-size: 12px;
`;

const ColorIndicator = styled.div<{ color: string }>`
  width: 8px;
  height: 100%;
  background-color: ${({ color }) => color};
  position: absolute;
  top: 0;
  left: 0;
  transition: transform 0.3s linear, background-color 0.3s ease-out;

  &:hover {
    transform: scaleX(2);
  }
`;

const ColorPickerContainer = styled.div`
  position: absolute;
  top: 0;
  left: calc(100% + 8px);
`;

const GroupButtonContainer = styled.div`
  position: relative;
  max-width: fit-content;
`;

export default function Settings(): JSX.Element {
  const [activeTab, setActiveTab] = useState<"General" | "Appearance" | "Backup" | "Filter" | "Keyboard">("General");
  const [showPicker, setShowPicker] = useState(false);

  const [allowShortcuts, setAllowShortcuts] = useLocalStorage("allowShortcuts", true);
  const [ignoreURL, setIgnoreURL] = useLocalStorage("ignoreURL", true);
  const [confirmDelete, setConfirmDelete] = useLocalStorage("confirmDelete", true);
  const [showBadgeInfo, setShowBadgeInfo] = useLocalStorage("showBadgeInfo", true);
  const [groupTitle, setGroupTitle] = useLocalStorage("groupTitle", DEFAULT_GROUP_TITLE);
  const [groupColor, setGroupColor] = useLocalStorage("groupColor", DEFAULT_GROUP_COLOR);

  const [allCommands, setAllCommands] = useState<chrome.commands.Command[]>([]);

  const emptyCommands = allCommands.filter((command) => command.shortcut === "");

  const debouncedColor = useDebounce(groupColor);

  const pickerRef = useRef<HTMLDivElement>(null);

  useClickOutside<HTMLDivElement>({ ref: pickerRef, preCondition: showPicker, cb: () => setShowPicker(false) });

  useEffect(() => {
    if (activeTab === "Keyboard") {
      chrome.commands.getAll((commands) =>
        setAllCommands(
          [{ description: "Activate Extension", shortcut: "Alt + T", name: "_execute_action" }, ...commands].sort(
            (a, b) => a.description?.localeCompare(b.description ?? "") ?? 0
          )
        )
      );
    }
  }, [activeTab]);

  return (
    <>
      <Selector
        opts={["General", "Appearance", "Backup", "Filter", "Keyboard"]}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {activeTab === "General" && (
        <>
          {[
            {
              label: "Ignore URL parameters and query strings during search",
              id: "ignoreURL",
              checked: ignoreURL,
              onChange: () => setIgnoreURL(!ignoreURL)
            },
            {
              label: "Confirm destructive actions (those that delete items)",
              id: "confirmDestructive",
              checked: confirmDelete,
              onChange: () => setConfirmDelete(!confirmDelete)
            },
            {
              label: "Display Badge Information (extension icon count)",
              id: "badgeInformation",
              checked: showBadgeInfo,
              onChange: () => setShowBadgeInfo(!showBadgeInfo)
            }
          ].map((item) => (
            <CheckboxContainer key={item.label}>
              <input type="checkbox" id={item.id} name={item.id} checked={item.checked} onChange={item.onChange} />
              <label htmlFor={item.id}>{item.label}</label>
            </CheckboxContainer>
          ))}

          <GroupButtonContainer>
            <GroupButton>
              <Headline value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} />

              <Information>
                <span>0T | 0W</span> <span>&lt; 1 min</span>
              </Information>

              <ColorIndicator
                color={debouncedColor}
                role="button"
                tabIndex={0}
                onClick={() => setShowPicker(true)}
                onKeyPress={(e) => e.key === "Enter" && setShowPicker(true)}
              />
            </GroupButton>

            {showPicker && (
              <ColorPickerContainer ref={pickerRef}>
                <ColorPicker color={debouncedColor} setColor={setGroupColor} />
              </ColorPickerContainer>
            )}
          </GroupButtonContainer>

          <p>Default Window Title</p>
          <p>Default Favicon URL</p>
        </>
      )}

      {activeTab === "Appearance" && (
        <div>
          <p>Dark/Light Mode with example</p>
        </div>
      )}

      {activeTab === "Backup" && (
        <div>
          <p>Automatic Export every X minutes to folder, keeping most recent Y backups</p>
          <p>Automatic Sync every X minutes</p>
        </div>
      )}

      {activeTab === "Filter" && (
        <div>
          <p>
            The following websites are excluded from TabMerger (default chrome:// and new tab), RegExp to filter for
            https?://www.
          </p>
        </div>
      )}

      {activeTab === "Keyboard" && (
        <>
          <CheckboxContainer>
            <input
              type="checkbox"
              id="allowShortcuts"
              name="allowShortcuts"
              checked={allowShortcuts}
              onChange={() => setAllowShortcuts(!allowShortcuts)}
            />
            <label htmlFor="allowShortcuts">Keyboard Shortcuts</label>
          </CheckboxContainer>

          <ShortcutGrid>
            {allCommands.map((command, i) => (
              <ShortcutItem key={(command.name ?? "") + i} $disabled={command.shortcut === ""}>
                <span>{command.shortcut}</span> {command.description}
              </ShortcutItem>
            ))}
          </ShortcutGrid>

          {emptyCommands.length > 0 && <Message $error>There are {emptyCommands.length} disabled commands</Message>}

          <Note>
            <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

            <div>
              <p>
                Visit the <Link href={CHROME_SHORTCUTS} title="Shortcuts Menu" /> to adjust these keyboard shortcuts.
              </p>
              <p>Empty fields are not active!</p>
            </div>
          </Note>
        </>
      )}
    </>
  );
}

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

import Link from "./Link";
import Selector from "./Selector";

import { CHROME_SHORTCUTS } from "~/constants/urls";
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

export default function Settings(): JSX.Element {
  const [activeTab, setActiveTab] = useState<"General" | "Appearance" | "Backup" | "Filter" | "Keyboard">("General");

  const [allowShortcuts, setAllowShortcuts] = useLocalStorage("allowShortcuts", true);

  const [allCommands, setAllCommands] = useState<chrome.commands.Command[]>([]);

  const emptyCommands = allCommands.filter((command) => command.shortcut === "");

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
        <div>
          <p>Ignore URL parameters and query strings during search</p>
          <p>Confirm destructive actions (those that delete items)</p>
          <p>Default Group Color</p>
          <p>Default Group Title</p>
          <p>Default Window Title</p>
          <p>Display Badge Information (extension icon count)</p>
          <p>Default Favicon URL</p>
        </div>
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

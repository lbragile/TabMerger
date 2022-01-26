import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Fragment, useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import { CHROME_SHORTCUTS } from "~/constants/urls";
import useClickOutside from "~/hooks/useClickOutside";
import useLocalStorage from "~/hooks/useLocalStorage";
import { Message } from "~/styles/Message";
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
    box-shadow: 0 1px 0 #0002, 0 0 0 2px ${({ theme }) => theme.colors.background} inset;
    background-color: ${({ theme }) => theme.colors.secondary};
    color: ${({ theme }) => theme.colors.onSecondary};
  }

  ${({ $disabled }) =>
    $disabled &&
    css`
      opacity: 0.5;
    `}
`;

export default function Keyboard(): JSX.Element {
  const [showPicker, setShowPicker] = useState(false);

  const [allowShortcuts, setAllowShortcuts] = useLocalStorage("allowShortcuts", true);

  const [allCommands, setAllCommands] = useState<chrome.commands.Command[]>([]);

  const emptyCommands = allCommands.filter((command) => command.shortcut === "");

  const pickerRef = useRef<HTMLDivElement>(null);

  useClickOutside<HTMLDivElement>({ ref: pickerRef, preCondition: showPicker, cb: () => setShowPicker(false) });

  useEffect(() => {
    chrome.commands.getAll((commands) =>
      setAllCommands(
        [{ description: "Activate Extension", shortcut: "Alt+T", name: "_execute_action" }, ...commands].sort(
          (a, b) => a.description?.localeCompare(b.description ?? "") ?? 0
        )
      )
    );
  }, []);

  return (
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
            <div>
              {command.shortcut?.split("+")?.map((item, i, array) => (
                <Fragment key={item + i}>
                  <span>{item}</span>
                  {i !== array.length - 1 ? "+" : ""}
                </Fragment>
              ))}
            </div>{" "}
            {command.description}
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

      <ModalFooter showSave={false} closeText="Close" />
    </>
  );
}

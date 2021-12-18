import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { faEllipsisV } from "@fortawesome/free-solid-svg-icons";
import { faWindowRestore } from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IGroupState } from "../../store/reducers/groups";
import { useDispatch } from "../../hooks/useDispatch";
import GROUPS_CREATORS from "../../store/actions/groups";
import { getReadableTimestamp, pluralize } from "../../utils/helper";
import Dropdown from "../Dropdown";
import useClickOutside from "../../hooks/useClickOutside";

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: 2px;
  column-gap: 8px;
  justify-content: space-between;
  align-items: start;
  padding: 2px 0;
  margin-bottom: 4px;
`;

const ActionButton = styled.button<{ $disabled?: boolean }>`
  all: unset;
  position: relative;
  display: inline-flex;
  align-items: center;
  column-gap: 8px;
  padding: 2px 4px;
  margin-left: 8px;
  font-size: 16px;
  text-transform: capitalize;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? "0.5" : "1")};

  &:hover {
    background-color: #e8e8e8aa;
  }
`;

const Title = styled.input<{ $isMaxLength: boolean }>`
  font-weight: bold;
  font-size: 16px;
  border: none;
  outline: none;
  border-bottom: 1px solid transparent;
  width: 300px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;

  &:hover {
    border-bottom: 1px solid rgba(0, 0, 0, 0.2);
  }

  &:focus {
    border-bottom: 1px solid black;
    background-color: ${({ $isMaxLength }) => ($isMaxLength ? "#ffd1d1" : "initial")};
  }
`;

const SubTitle = styled.span<{ $right?: boolean }>`
  font-size: 14px;
  ${({ $right }) =>
    $right
      ? css`
          justify-self: end;
          margin: 0 4px;
        `
      : css`
          justify-self: start;
          margin: 0;
        `}
`;

interface IInformation extends Pick<IGroupState, "info" | "name" | "updatedAt"> {
  groupIndex: number;
}

export default function Information({ info, name, groupIndex, updatedAt }: IInformation): JSX.Element {
  const dispatch = useDispatch();

  const [windowTitle, setWindowTitle] = useState("");
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const [showOpenPopup, setShowOpenPopup] = useState(false);

  const settingsIconRef = useRef<HTMLButtonElement | null>(null);
  const openIconRef = useRef<HTMLButtonElement | null>(null);

  const [numTabs, numWindows] = info?.split(" | ")?.map((count) => Number(count.slice(0, -1))) ?? [0, 0];

  useClickOutside<HTMLButtonElement>({
    ref: settingsIconRef,
    preCondition: showSettingsPopup,
    cb: () => setShowSettingsPopup(false)
  });

  useClickOutside<HTMLButtonElement>({
    ref: openIconRef,
    preCondition: showOpenPopup,
    cb: () => setShowOpenPopup(false)
  });

  useEffect(() => setWindowTitle(name), [name]);

  return (
    <Grid>
      <Title
        type="text"
        value={windowTitle}
        spellCheck={false}
        onChange={(e) => setWindowTitle(e.target.value)}
        onBlur={() => dispatch(GROUPS_CREATORS.updateName({ index: groupIndex, name: windowTitle }))}
        onKeyPress={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={40}
        $isMaxLength={windowTitle.length === 40}
      />

      <span>
        <ActionButton
          ref={openIconRef}
          onClick={() => groupIndex > 0 && setShowOpenPopup(true)}
          $disabled={groupIndex === 0}
        >
          <FontAwesomeIcon icon={faWindowRestore} />

          <span>open</span>

          {showOpenPopup && openIconRef.current && (
            <Dropdown
              items={[
                {
                  text: (
                    <p>
                      Open {numTabs} Tabs <b>In 1 New Window</b>
                    </p>
                  ),
                  handler: () => console.log("WIP")
                },
                {
                  text: (
                    <p>
                      Open {numTabs} Tabs{" "}
                      <b>
                        In {numWindows} {pluralize(numWindows, "Window")}
                      </b>
                    </p>
                  ),
                  handler: () => console.log("WIP")
                },
                {
                  text: (
                    <p>
                      Open {numTabs} Tabs <b>In Current Window</b>
                    </p>
                  ),
                  handler: () => console.log("WIP")
                }
              ]}
              pos={{ top: openIconRef.current.getBoundingClientRect().height + 4 }}
            />
          )}
        </ActionButton>

        <ActionButton ref={settingsIconRef} onClick={() => setShowSettingsPopup(true)}>
          <FontAwesomeIcon icon={faEllipsisV} />

          {showSettingsPopup && settingsIconRef.current && (
            <Dropdown
              items={[
                { text: "Rename", handler: () => console.log("WIP") },
                { text: "Duplicate", handler: () => console.log("WIP") },
                { text: "divider" },
                { text: "Sort By Window Title", handler: () => console.log("WIP") },
                { text: "Sort By Tab Title", handler: () => console.log("WIP") },
                { text: "Sort By Tab URL", handler: () => console.log("WIP") },
                { text: "divider" },
                { text: "Replace With Current", handler: () => console.log("WIP") },
                { text: "Merge With Current", handler: () => console.log("WIP") },
                { text: "divider" },
                { text: "Unite Windows", handler: () => console.log("WIP") },
                { text: "Delete", handler: () => console.log("WIP"), isDanger: true }
              ]}
              pos={{ top: settingsIconRef.current.getBoundingClientRect().height + 4 }}
            />
          )}
        </ActionButton>
      </span>

      <SubTitle>{getReadableTimestamp(updatedAt)}</SubTitle>

      <SubTitle $right>{info}</SubTitle>
    </Grid>
  );
}

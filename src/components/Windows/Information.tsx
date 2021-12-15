import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { faEllipsisV } from "@fortawesome/free-solid-svg-icons";
import { faWindowRestore } from "@fortawesome/free-regular-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { IGroupState } from "../../store/reducers/groups";
import { useDispatch } from "../../hooks/useDispatch";
import GROUPS_CREATORS from "../../store/actions/groups";
import { getReadableTimestamp } from "../../utils/helper";
import Dropdown from "../Dropdown";
import useClickOutside from "../../hooks/useClickOutside";

const Grid = styled.div`
  display: grid;
  grid-template-columns: 3fr 1fr;
  row-gap: 2px;
  justify-content: space-between;
  align-items: start;
  padding: 2px 0;
  margin-bottom: 4px;
`;

const LeftColumn = styled.div`
  justify-self: start;
`;

const RightColumn = styled.div`
  justify-self: end;
`;

const RelativeContainer = styled.div`
  position: relative;
  display: inline-block;
`;

const SettingsIcon = styled(FontAwesomeIcon)`
  cursor: pointer;
  font-size: 16px;
`;

const OpenIcon = styled(FontAwesomeIcon)<{ $disabled: boolean }>`
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? "0.5" : "1")};
  margin-right: 8px;
  font-size: 16px;
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

const SubTitle = styled.span`
  font-size: 14px;
`;

interface IInformation extends Pick<IGroupState, "info" | "name" | "updatedAt"> {
  groupIndex: number;
}

export default function Information({ info, name, groupIndex, updatedAt }: IInformation): JSX.Element {
  const dispatch = useDispatch();

  const [windowTitle, setWindowTitle] = useState("");
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const [showOpenPopup, setShowOpenPopup] = useState(false);

  const settingsIconRef = useRef<HTMLDivElement | null>(null);
  const openIconRef = useRef<HTMLDivElement | null>(null);

  useClickOutside<HTMLDivElement>({
    ref: settingsIconRef,
    preCondition: showSettingsPopup,
    cb: () => setShowSettingsPopup(false)
  });

  useClickOutside<HTMLDivElement>({
    ref: openIconRef,
    preCondition: showOpenPopup,
    cb: () => setShowOpenPopup(false)
  });

  useEffect(() => setWindowTitle(name), [name]);

  return (
    <Grid>
      <LeftColumn>
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
      </LeftColumn>

      <RightColumn>
        <RelativeContainer ref={openIconRef}>
          <OpenIcon
            $disabled={groupIndex === 0}
            icon={faWindowRestore}
            tabIndex={0}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => groupIndex > 0 && setShowOpenPopup(true)}
          />

          {showOpenPopup && openIconRef.current && (
            <Dropdown
              items={[
                { text: "Copy To Group", handler: () => console.log("WIP") },
                { text: "Copy To Group", handler: () => console.log("WIP") },
                { text: "Move To Group", handler: () => console.log("WIP") }
              ]}
              pos={{ top: openIconRef.current.getBoundingClientRect().height + 4, right: 8 }}
            />
          )}
        </RelativeContainer>

        <RelativeContainer ref={settingsIconRef}>
          <SettingsIcon
            icon={faEllipsisV}
            tabIndex={0}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setShowSettingsPopup(true)}
          />

          {showSettingsPopup && settingsIconRef.current && (
            <Dropdown
              items={[
                { text: "Copy To Group", handler: () => console.log("WIP") },
                { text: "Move To Group", handler: () => console.log("WIP") },
                { text: "divider" },
                { text: "Star", handler: () => console.log("WIP") },
                { text: `"Make" Incognito`, handler: () => console.log("WIP") },
                { text: "divider" },
                { text: "Rename", handler: () => console.log("WIP") },
                { text: "Delete", handler: () => console.log("WIP") }
              ]}
              pos={{ top: settingsIconRef.current.getBoundingClientRect().height + 4 }}
            />
          )}
        </RelativeContainer>
      </RightColumn>

      <LeftColumn>
        <SubTitle>{getReadableTimestamp(updatedAt)}</SubTitle>
      </LeftColumn>

      <RightColumn>
        <SubTitle>{info}</SubTitle>
      </RightColumn>
    </Grid>
  );
}

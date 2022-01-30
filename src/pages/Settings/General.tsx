import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, useRef, useMemo, useEffect } from "react";
import styled from "styled-components";

import Checkbox from "~/components/Checkbox";
import ColorPicker from "~/components/ColorPicker";
import { ModalFooter } from "~/components/Modal";
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE, DEFAULT_WINDOW_TITLE } from "~/constants/defaults";
import useClickOutside from "~/hooks/useClickOutside";
import { useDebounce } from "~/hooks/useDebounce";
import useLocalStorage from "~/hooks/useLocalStorage";
import { Note } from "~/styles/Note";
import { SectionTitle } from "~/styles/SectionTitle";

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const GroupButton = styled.div`
  width: 209px;
  height: 49px;
  background-color: ${({ theme }) => theme.colors.surface};
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

const GroupInformation = styled.div`
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

const WindowTitle = styled.input`
  all: unset;
  font-size: 15px;
  width: calc(100% - 8px);
  padding: 0 4px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;

  &:hover,
  &:focus-visible {
    background-color: #dfdfdfb7;
  }
`;

const WindowHeadline = styled.div`
  display: grid;
  grid-template-columns: auto 25ch auto;
  column-gap: 6px;
  justify-content: start;
  align-items: center;
  background-color: transparent;
  padding: 0 2px;
  border: 1px dashed initial;

  & svg {
    max-width: 14px;
    transition: transform 0.3s ease;

    &:hover,
    &:focus-visible {
      transform: scale(1.25);
    }
  }
`;

const TabCounter = styled.span`
  color: ${({ theme }) => theme.colors.onBackground};
  opacity: 0.75;
  cursor: default;
`;

export default function General(): JSX.Element {
  const [showPicker, setShowPicker] = useState(false);

  const [confirmDelete, setConfirmDelete] = useLocalStorage("confirmDelete", true);
  const [showBadgeInfo, setShowBadgeInfo] = useLocalStorage("showBadgeInfo", false);
  const [groupTitle, setGroupTitle] = useLocalStorage("groupTitle", DEFAULT_GROUP_TITLE);
  const [groupColor, setGroupColor] = useLocalStorage("groupColor", DEFAULT_GROUP_COLOR);
  const [windowTitle, setWindowTitle] = useLocalStorage("windowTitle", DEFAULT_WINDOW_TITLE);

  const [localConfirmDelete, setLocalConfirmDelete] = useState(true);
  const [localShowBadgeInfo, setLocalShowBadgeInfo] = useState(true);
  const [localGroupTitle, setLocalGroupTitle] = useState(DEFAULT_GROUP_TITLE);
  const [localGroupColor, setLocalGroupColor] = useState(DEFAULT_GROUP_COLOR);
  const [localWindowTitle, setLocalWindowTitle] = useState(DEFAULT_WINDOW_TITLE);

  useEffect(() => setLocalConfirmDelete(confirmDelete), [confirmDelete]);
  useEffect(() => setLocalShowBadgeInfo(showBadgeInfo), [showBadgeInfo]);
  useEffect(() => setLocalGroupTitle(groupTitle), [groupTitle]);
  useEffect(() => setLocalGroupColor(groupColor), [groupColor]);
  useEffect(() => setLocalWindowTitle(windowTitle), [windowTitle]);

  const debouncedColor = useDebounce(localGroupColor);

  const pickerRef = useRef<HTMLDivElement>(null);

  useClickOutside<HTMLDivElement>({ ref: pickerRef, preCondition: showPicker, cb: () => setShowPicker(false) });

  const settingsOptions = useMemo(
    () => [
      {
        label: "Confirm destructive actions (those that delete items)",
        id: "confirmDestructive",
        checked: localConfirmDelete,
        onChange: () => setLocalConfirmDelete(!localConfirmDelete)
      },
      {
        label: "Display stored tab count in extension icon (popup reload required)",
        id: "badgeInformation",
        checked: localShowBadgeInfo,
        onChange: () => setLocalShowBadgeInfo(!localShowBadgeInfo)
      }
    ],
    [localConfirmDelete, localShowBadgeInfo, setLocalConfirmDelete, setLocalShowBadgeInfo]
  );

  return (
    <>
      <Column>
        {settingsOptions.map((item) => (
          <Checkbox key={item.label} id={item.id} text={item.label} checked={item.checked} setChecked={item.onChange} />
        ))}
      </Column>

      <Column>
        <SectionTitle>Default Group</SectionTitle>

        <GroupButtonContainer>
          <GroupButton>
            <Headline value={localGroupTitle} onChange={(e) => setLocalGroupTitle(e.target.value)} />

            <GroupInformation>
              <span>0T | 0W</span> <span>&lt; 1 min</span>
            </GroupInformation>

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
              <ColorPicker color={debouncedColor} setColor={setLocalGroupColor} />
            </ColorPickerContainer>
          )}
        </GroupButtonContainer>
      </Column>

      <Column>
        <SectionTitle>Default Window Title</SectionTitle>
        <WindowHeadline>
          <FontAwesomeIcon icon={["far", "window-maximize"]} />

          <WindowTitle
            type="text"
            value={localWindowTitle}
            onChange={({ target: { value } }) => setLocalWindowTitle(value)}
          />

          <TabCounter>0 Tabs</TabCounter>
        </WindowHeadline>
      </Column>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>
            The Favicon URL must start with <b>http://www.</b> or <b>https://www.</b>
          </p>
          <p>Improper input will result in a default favicon symbol.</p>
        </div>
      </Note>

      <ModalFooter
        showSave
        closeText="Close"
        handleSave={() => {
          setConfirmDelete(localConfirmDelete);
          setShowBadgeInfo(localShowBadgeInfo);
          setGroupTitle(localGroupTitle);
          setGroupColor(localGroupColor);
          setWindowTitle(localWindowTitle);
        }}
      />
    </>
  );
}

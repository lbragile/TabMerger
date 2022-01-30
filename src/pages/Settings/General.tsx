import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, useRef, useMemo, useEffect } from "react";

import Checkbox from "~/components/Checkbox";
import ColorPicker from "~/components/ColorPicker";
import { ModalFooter } from "~/components/Modal";
import Note from "~/components/Note";
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE, DEFAULT_WINDOW_TITLE } from "~/constants/defaults";
import useClickOutside from "~/hooks/useClickOutside";
import { useDebounce } from "~/hooks/useDebounce";
import useLocalStorage from "~/hooks/useLocalStorage";
import { Column } from "~/styles/Column";
import {
  GroupButtonContainer,
  GroupButton,
  GroupInformation,
  ColorIndicator,
  ColorPickerContainer,
  GroupHeadline,
  AbsoluteCloseIcon
} from "~/styles/Group";
import { SectionTitle } from "~/styles/SectionTitle";
import { WindowHeadline, WindowTitle, TabCounter } from "~/styles/Window";

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
      <Column $gap="8px">
        {settingsOptions.map((item) => (
          <Checkbox key={item.label} id={item.id} text={item.label} checked={item.checked} setChecked={item.onChange} />
        ))}
      </Column>

      <Column $gap="8px">
        <SectionTitle>Default Group</SectionTitle>

        <GroupButtonContainer>
          <GroupButton>
            <GroupHeadline value={localGroupTitle} onChange={(e) => setLocalGroupTitle(e.target.value)} />

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

          <AbsoluteCloseIcon icon="times" />

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
        <p>
          The Favicon URL must start with <b>http://www.</b> or <b>https://www.</b>
        </p>

        <p>Improper input will result in a default favicon symbol</p>
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

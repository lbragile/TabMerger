import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, useRef, useMemo } from "react";

import Checkbox from "~/components/Checkbox";
import ColorPicker from "~/components/ColorPicker";
import { ModalFooter } from "~/components/Modal";
import Note from "~/components/Note";
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE, DEFAULT_WINDOW_TITLE } from "~/constants/defaults";
import useClickOutside from "~/hooks/useClickOutside";
import { useDebounce } from "~/hooks/useDebounce";
import useStorageWithSave from "~/hooks/useStorageWithSave";
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

  const [, setConfirmDelete, localConfirmDelete, setLocalConfirmDelete] = useStorageWithSave("confirmDelete", true);

  const [, setShowBadgeInfo, localShowBadgeInfo, setLocalShowBadgeInfo] = useStorageWithSave("showBadgeInfo", false);

  const [, setGroupTitle, localGroupTitle, setLocalGroupTitle] = useStorageWithSave("groupTitle", DEFAULT_GROUP_TITLE);

  const [, setGroupColor, localGroupColor, setLocalGroupColor] = useStorageWithSave("groupColor", DEFAULT_GROUP_COLOR);

  const [, setWindowTitle, localWindowTitle, setLocalWindowTitle] = useStorageWithSave(
    "windowTitle",
    DEFAULT_WINDOW_TITLE
  );

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
        label: "Display stored tab count in extension icon (reload required)",
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
          <b>Default Group & Default Window Title</b> apply to newly created items
        </p>
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

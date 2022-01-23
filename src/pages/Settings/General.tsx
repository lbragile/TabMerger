import { useState, useRef } from "react";
import styled from "styled-components";

import ColorPicker from "~/components/ColorPicker";
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE } from "~/constants/defaults";
import useClickOutside from "~/hooks/useClickOutside";
import { useDebounce } from "~/hooks/useDebounce";
import useLocalStorage from "~/hooks/useLocalStorage";

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

export default function General(): JSX.Element {
  const [showPicker, setShowPicker] = useState(false);

  const [ignoreURL, setIgnoreURL] = useLocalStorage("ignoreURL", true);
  const [confirmDelete, setConfirmDelete] = useLocalStorage("confirmDelete", true);
  const [showBadgeInfo, setShowBadgeInfo] = useLocalStorage("showBadgeInfo", true);
  const [groupTitle, setGroupTitle] = useLocalStorage("groupTitle", DEFAULT_GROUP_TITLE);
  const [groupColor, setGroupColor] = useLocalStorage("groupColor", DEFAULT_GROUP_COLOR);

  const debouncedColor = useDebounce(groupColor);

  const pickerRef = useRef<HTMLDivElement>(null);

  useClickOutside<HTMLDivElement>({ ref: pickerRef, preCondition: showPicker, cb: () => setShowPicker(false) });

  return (
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
  );
}

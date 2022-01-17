import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useMemo, useRef, useState } from "react";
import styled, { css } from "styled-components";

import Dropdown, { IDropdown } from "~/components/Dropdown";
import { GOOGLE_HOMEPAGE } from "~/constants/urls";
import useClickOutside from "~/hooks/useClickOutside";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import useRename from "~/hooks/useRename";
import {
  duplicateGroup,
  sortByTabTitle,
  sortByTabUrl,
  uniteWindows,
  splitWindows,
  mergeWithCurrent,
  replaceWithCurrent,
  updateGroupName,
  deleteGroup
} from "~/store/actions/groups";
import { getReadableTimestamp, pluralize } from "~/utils/helper";

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
    border-bottom: 1px solid rgb(0 0 0 / 20%);
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

export default function Information(): JSX.Element {
  const dispatch = useDispatch();

  const {
    active: { index: groupIndex },
    available
  } = useSelector((state) => state.groups);

  const { windows, info, name, updatedAt } = available[groupIndex];

  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const [showOpenPopup, setShowOpenPopup] = useState(false);

  const titleRef = useRef<HTMLInputElement | null>(null);
  const settingsIconRef = useRef<HTMLButtonElement | null>(null);
  const openIconRef = useRef<HTMLButtonElement | null>(null);

  const [numTabs, numWindows] = info?.split(" | ")?.map((count) => Number(count.slice(0, -1))) ?? [0, 0];
  const isDropdownItemDisabled = groupIndex === 0;

  const [windowTitle, setWindowTitle] = useRename(
    () => dispatch(updateGroupName({ groupIndex, name: windowTitle })),
    name
  );

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

  const dropdownItemHandlerWrapper = (
    e: React.MouseEvent<HTMLDivElement, MouseEvent> | React.KeyboardEvent<HTMLDivElement> | undefined,
    action: () => void
  ) => {
    // Parent (settings icon will receive the bubbled event if propagation isn't stopped)
    e?.stopPropagation();
    action();
    setShowSettingsPopup(false);
  };

  const openWindows = useCallback(
    (type: "current" | "new" | "separate", isIncognito = false) => {
      if (type !== "new") {
        windows.forEach(({ tabs, incognito, state }) => {
          type === "current"
            ? tabs?.forEach((t) => {
                const { active, pinned, url } = t ?? {};
                chrome.tabs.create({ active, pinned, url }, () => "");
              })
            : chrome.windows.create(
                { incognito, state, type: "normal", url: tabs?.map((t) => t?.url ?? GOOGLE_HOMEPAGE) },
                () => ""
              );
        });
      } else {
        chrome.windows.create(
          {
            incognito: isIncognito,
            state: "maximized",
            type: "normal",
            url: windows.flatMap((w) => w.tabs?.map((t) => t?.url ?? GOOGLE_HOMEPAGE) ?? [])
          },
          () => ""
        );
      }

      setShowOpenPopup(false);
    },
    [windows]
  );

  const settingsItems = useMemo(
    () =>
      [
        {
          text: "Rename",
          handler: (e) => dropdownItemHandlerWrapper(e, () => titleRef.current?.select())
        },
        {
          text: groupIndex === 0 ? "Save" : "Duplicate",
          handler: (e) => dropdownItemHandlerWrapper(e, () => dispatch(duplicateGroup(groupIndex)))
        },
        { text: "divider" },
        {
          text: "Sort By Tab Title",
          handler: (e) => dropdownItemHandlerWrapper(e, () => dispatch(sortByTabTitle(groupIndex))),
          isDisabled: isDropdownItemDisabled
        },
        {
          text: "Sort By Tab URL",
          handler: (e) => dropdownItemHandlerWrapper(e, () => dispatch(sortByTabUrl(groupIndex))),
          isDisabled: isDropdownItemDisabled
        },
        { text: "divider" },
        {
          text: "Unite Windows",
          handler: (e) => dropdownItemHandlerWrapper(e, () => dispatch(uniteWindows(groupIndex))),
          isDisabled: isDropdownItemDisabled || numWindows === 1
        },
        {
          text: "Split Windows",
          handler: (e) => dropdownItemHandlerWrapper(e, () => dispatch(splitWindows(groupIndex))),
          isDisabled: isDropdownItemDisabled || numTabs === 1
        },
        { text: "divider" },
        {
          text: "Merge With Current",
          handler: (e) => dropdownItemHandlerWrapper(e, () => dispatch(mergeWithCurrent(groupIndex))),
          isDisabled: isDropdownItemDisabled
        },
        {
          text: "Replace With Current",
          handler: (e) => dropdownItemHandlerWrapper(e, () => dispatch(replaceWithCurrent(groupIndex))),
          isDisabled: isDropdownItemDisabled,
          isDanger: true
        },
        { text: "divider" },
        {
          text: "Delete",
          handler: () => dispatch(deleteGroup(groupIndex)),
          isDisabled: isDropdownItemDisabled,
          isDanger: true
        }
      ] as IDropdown["items"],
    [dispatch, groupIndex, isDropdownItemDisabled, numTabs, numWindows]
  );

  const openItems = useMemo(
    () =>
      [
        {
          text: (
            <p>
              Open <b>{numTabs}</b> {pluralize(numTabs, "Tab")} In <b>Current</b> Window
            </p>
          ),
          handler: () => openWindows("current")
        },
        {
          text: (
            <p>
              Open <b>{numTabs}</b> Tabs In <b>{numWindows}</b> {pluralize(numWindows, "Window")}
            </p>
          ),
          handler: () => openWindows("separate"),
          isDisabled: numWindows === 1
        },
        { text: "divider" },
        {
          text: (
            <p>
              Open <b>{numTabs}</b> {pluralize(numTabs, "Tab")} In <b>Regular</b> Window
            </p>
          ),
          handler: () => openWindows("new")
        },
        {
          text: (
            <p>
              Open <b>{numTabs}</b> {pluralize(numTabs, "Tab")} In <b>Incognito</b> Window
            </p>
          ),
          handler: () => openWindows("new", true)
        }
      ] as IDropdown["items"],
    [numTabs, numWindows, openWindows]
  );

  return (
    <Grid>
      <Title
        ref={titleRef}
        type="text"
        value={windowTitle}
        onChange={(e) => setWindowTitle(e.target.value)}
        onKeyPress={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={40}
        $isMaxLength={windowTitle.length === 40}
      />

      <span>
        <ActionButton
          ref={openIconRef}
          onClick={() => groupIndex > 0 && setShowOpenPopup(!showOpenPopup)}
          tabIndex={groupIndex > 0 ? 0 : -1}
          $disabled={groupIndex === 0}
        >
          <FontAwesomeIcon icon={["far", "window-restore"]} />

          <span>open</span>

          {showOpenPopup && openIconRef.current && (
            <Dropdown items={openItems} pos={{ top: openIconRef.current.getBoundingClientRect().height + 4 }} />
          )}
        </ActionButton>

        <ActionButton ref={settingsIconRef} onClick={() => setShowSettingsPopup(!showSettingsPopup)}>
          <FontAwesomeIcon icon="ellipsis-v" title="More Options" />

          {showSettingsPopup && settingsIconRef.current && (
            <Dropdown items={settingsItems} pos={{ top: settingsIconRef.current.getBoundingClientRect().height + 4 }} />
          )}
        </ActionButton>
      </span>

      <SubTitle>Updated {getReadableTimestamp(updatedAt)}</SubTitle>

      <SubTitle $right>{info}</SubTitle>
    </Grid>
  );
}

import styled from "styled-components";

import Checkbox from "~/components/Checkbox";
import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import Note from "~/components/Note";
import { useSelector } from "~/hooks/useRedux";
import useStorageWithSave from "~/hooks/useStorageWithSave";
import { Column } from "~/styles/Column";
import { AbsoluteCloseIcon, ColorIndicator, GroupButton, GroupHeadline, GroupInformation } from "~/styles/Group";
import { ThemeOptions } from "~/styles/ThemeOptions";
import { relativeTimeStr } from "~/utils/helper";

const StyledGroupButton = styled(GroupButton)<{ $theme: typeof ThemeOptions["light"]; $active: boolean }>`
  background-color: ${({ $theme }) => $theme.colors.surface};
  color: ${({ $theme }) => $theme.colors.onSurface};
  outline: ${({ $active, $theme }) =>
    $active ? `3px solid ${$theme.colors.primary}` : `1px solid ${$theme.colors.onBackground + "2"}`};
  outline-offset: -1px;
`;

const StyledGroupHeadline = styled(GroupHeadline).attrs(() => ({ as: "div" }))`
  &:hover {
    background-color: #dfdfdfb7;
    border-bottom: none;
    cursor: grabbing;
  }
`;

type TSelectedTheme = "light" | "dark";

export default function Theme(): JSX.Element {
  const { available } = useSelector((state) => state.groups.present);

  const [, setDarkMode, localDarkMode, setLocalDarkMode] = useStorageWithSave("darkMode", false);

  const [, setItalicizeNonHttp, localItalicizeNonHttp, setLocalItalicizeNonHttp] = useStorageWithSave(
    "italicizeNonHttp",
    true
  );

  return (
    <>
      {(["light", "dark"] as TSelectedTheme[]).map((text) => (
        <Column key={text}>
          <h3>{text[0].toUpperCase() + text.slice(1)}</h3>

          <StyledGroupButton
            $theme={ThemeOptions[text]}
            $active={(localDarkMode && text === "dark") || (!localDarkMode && text === "light")}
            tabIndex={0}
            role="button"
            onClick={() => setLocalDarkMode(text === "dark")}
            onKeyPress={({ code }) => code === "Enter" && setLocalDarkMode(text === "dark")}
          >
            <StyledGroupHeadline>{available[0].name}</StyledGroupHeadline>

            <GroupInformation>
              <span>{available[0].info}</span> <span>{relativeTimeStr(available[0].updatedAt)}</span>
            </GroupInformation>

            <ColorIndicator color={available[0].color} />

            <AbsoluteCloseIcon icon="times" />
          </StyledGroupButton>
        </Column>
      ))}

      <Checkbox
        id="italicizeUrls"
        text={
          <>
            <i>Italicize</i> tab titles whose URL does not start with <b>http</b> or <b>https</b>
          </>
        }
        checked={localItalicizeNonHttp}
        setChecked={() => setLocalItalicizeNonHttp(!localItalicizeNonHttp)}
      />

      <Note>
        <p>
          Generally most URLs follow{" "}
          <Link href="https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol" title="HTTP protocol" />
        </p>

        <p>
          That said, sometimes they can be based on{" "}
          <Link href="https://en.wikipedia.org/wiki/List_of_URI_schemes" title="other protocols" />
        </p>
      </Note>

      <ModalFooter
        showSave
        closeText="Close"
        handleSave={() => {
          setDarkMode(localDarkMode);
          setItalicizeNonHttp(localItalicizeNonHttp);
        }}
      />
    </>
  );
}

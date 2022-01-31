import { useEffect, useState } from "react";
import styled from "styled-components";

import Checkbox from "~/components/Checkbox";
import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import Note from "~/components/Note";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useSelector } from "~/hooks/useRedux";
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
  const { available } = useSelector((state) => state.groups);

  const [darkMode, setDarkMode] = useLocalStorage("darkMode", false);
  const [italicizeNonHttp, setItalicizeNonHttp] = useLocalStorage("italicizeNonHttp", true);

  const [currentTheme, setCurrentTheme] = useState<TSelectedTheme>("dark");
  const [localItalicizeNonHttp, setLocalItalicizeNonHttp] = useState(true);

  useEffect(() => setCurrentTheme(darkMode ? "dark" : "light"), [darkMode]);
  useEffect(() => setLocalItalicizeNonHttp(italicizeNonHttp), [italicizeNonHttp]);

  return (
    <>
      {(["light", "dark"] as TSelectedTheme[]).map((text) => (
        <Column key={text}>
          <h3>{text[0].toUpperCase() + text.slice(1)}</h3>

          <StyledGroupButton
            $theme={ThemeOptions[text]}
            $active={currentTheme === text}
            tabIndex={0}
            role="button"
            onClick={() => setCurrentTheme(text)}
            onKeyPress={({ code }) => code === "Enter" && setCurrentTheme(text)}
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
          setDarkMode(currentTheme === "dark");
          setItalicizeNonHttp(localItalicizeNonHttp);
        }}
      />
    </>
  );
}

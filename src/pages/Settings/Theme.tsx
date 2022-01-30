import { useEffect, useState } from "react";
import styled from "styled-components";

import Checkbox from "~/components/Checkbox";
import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import Note from "~/components/Note";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useSelector } from "~/hooks/useRedux";
import { CloseIcon } from "~/styles/CloseIcon";
import { ThemeOptions } from "~/styles/ThemeOptions";
import { relativeTimeStr } from "~/utils/helper";

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const AbsoluteCloseIcon = styled(CloseIcon)`
  position: absolute;
  top: 4px;
  right: 4px;
`;

const GroupButton = styled.div<{ $theme: typeof ThemeOptions["light"]; $active: boolean }>`
  width: 209px;
  height: 49px;
  background-color: ${({ $theme }) => $theme.colors.surface};
  color: ${({ $theme }) => $theme.colors.onSurface};
  outline: ${({ $active }) => ($active ? "3px solid  #1d9bd0" : `1px solid rgb(0 0 0 / 10%)`)};
  outline-offset: -1px;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 2px 8px 2px 16px;
  cursor: pointer;

  &:hover ${AbsoluteCloseIcon} {
    color: ${({ $theme }) => $theme.colors.onSurface};
    display: block;

    &:hover {
      color: rgb(255 0 0 / 60%);
    }
  }
`;

const Headline = styled.div`
  font-size: 16px;
  font-weight: 600;
  width: fit-content;
  max-width: 95%;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  transition: background-color 0.3s ease, padding 0.3s ease;

  &:hover {
    padding: 0 4px;
    background-color: #dfdfdfb7;
    cursor: grabbing;
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

type TSelectedTheme = "light" | "dark";

export default function Theme(): JSX.Element {
  const { available } = useSelector((state) => state.groups);

  const [darkMode, setDarkMode] = useLocalStorage("darkMode", false);
  const [italicizeNonHttp, setItalicizeNonHttp] = useLocalStorage("italicizeNonHttp", true);

  const [theme, setTheme] = useState<TSelectedTheme>("dark");
  const [localItalicizeNonHttp, setLocalItalicizeNonHttp] = useState(true);

  useEffect(() => setTheme(darkMode ? "dark" : "light"), [darkMode]);
  useEffect(() => setLocalItalicizeNonHttp(italicizeNonHttp), [italicizeNonHttp]);

  return (
    <>
      {(["light", "dark"] as TSelectedTheme[]).map((text) => (
        <Column key={text}>
          <h3>{text[0].toUpperCase() + text.slice(1)}</h3>

          <GroupButton
            $theme={ThemeOptions[text]}
            $active={theme === text}
            tabIndex={0}
            role="button"
            onClick={() => setTheme(text)}
            onKeyPress={({ code }) => code === "Enter" && setTheme(text)}
          >
            <Headline>{available[0].name}</Headline>

            <GroupInformation>
              <span>{available[0].info}</span> <span>{relativeTimeStr(available[0].updatedAt)}</span>
            </GroupInformation>

            <ColorIndicator color={available[0].color} />

            <AbsoluteCloseIcon icon="times" />
          </GroupButton>
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
          setDarkMode(theme === "dark");
          setItalicizeNonHttp(localItalicizeNonHttp);
        }}
      />
    </>
  );
}

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import styled from "styled-components";

import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import useLocalStorage from "~/hooks/useLocalStorage";
import { Note } from "~/styles/Note";
import { ThemeOptions } from "~/styles/ThemeOptions";

const ButtonToggle = styled.div`
  display: flex;
  flex-direction: row;
  border: 1px solid #cce6ff;
  width: fit-content;
`;

const Choice = styled.button<{ active: boolean }>`
  background-color: ${({ active }) => (active ? "#cce6ff" : "inherit")};
  color: ${({ active, theme }) => (active ? "black" : theme.colors.onBackground)};
  min-width: 50px;
  padding: 4px 8px;
  border: none;
  outline: none;
  cursor: pointer;
  font-weight: 600;
`;

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

const ThemePreview = styled.div<{ $theme: TSelectedTheme }>`
  height: 200px;
  border: 1px solid #f0f0f0;
  background-color: ${({ $theme }) => ThemeOptions[$theme].colors.background};
  color: ${({ $theme }) => ThemeOptions[$theme].colors.onBackground};
`;

type TSelectedTheme = "light" | "dark";

export default function Theme(): JSX.Element {
  const [darkMode, setDarkMode] = useLocalStorage("darkMode", false);
  const [italicizeNonHttp, setItalicizeNonHttp] = useLocalStorage("italicizeNonHttp", true);

  const [theme, setTheme] = useState<TSelectedTheme>("dark");
  const [localItalicizeNonHttp, setLocalItalicizeNonHttp] = useState(true);

  useEffect(() => setTheme(darkMode ? "dark" : "light"), [darkMode]);
  useEffect(() => setLocalItalicizeNonHttp(italicizeNonHttp), [italicizeNonHttp]);

  return (
    <>
      <ButtonToggle>
        {(["light", "dark"] as TSelectedTheme[]).map((text) => (
          <Choice key={text} onMouseDown={() => setTheme(text)} active={theme === text}>
            {text[0].toUpperCase() + text.slice(1)}
          </Choice>
        ))}
      </ButtonToggle>

      <ThemePreview $theme={theme}>
        <div>Preview</div>
      </ThemePreview>

      <CheckboxContainer>
        <input
          type="checkbox"
          id="localItalicizeNonHttp"
          name="localItalicizeNonHttp"
          checked={localItalicizeNonHttp}
          onChange={() => setLocalItalicizeNonHttp(!localItalicizeNonHttp)}
        />
        <label htmlFor="localItalicizeNonHttp">
          <i>Italicize</i> tab titles whose URL does not start with <b>http</b> or <b>https</b>
        </label>
      </CheckboxContainer>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>
            Generally most URLs follow{" "}
            <Link href="https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol" title="HTTP protocol" />
          </p>
          <p>
            That said, sometimes they can be based on{" "}
            <Link href="https://en.wikipedia.org/wiki/List_of_URI_schemes" title="other protocols" />
          </p>
        </div>
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

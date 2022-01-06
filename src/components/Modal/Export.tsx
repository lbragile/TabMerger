import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MultiSelect } from "react-multi-select-component";
import styled, { css } from "styled-components";

import Selector from "./Selector";

import { DEFAULT_FAVICON_URL } from "~/constants/urls";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import MODAL_CREATORS from "~/store/actions/modal";
import { Note } from "~/styles/Note";
import { StyledLink } from "~/styles/StyledLink";
import { createActiveTab, formatHtml } from "~/utils/helper";

const CopyButton = styled(FontAwesomeIcon)<{ $overflow: boolean; $copied: boolean }>`
  display: none;
  position: absolute;
  top: 16px;
  right: ${({ $overflow }) => ($overflow ? "28px" : "12px")};
  color: ${({ $copied }) => ($copied ? "#00b300" : "#313131")};
  cursor: pointer;
  width: 16px;
  height: 16px;
  ${({ $copied }) =>
    !$copied &&
    css`
      &:hover {
        color: #616161;
      }
    `}
`;

const TextAreaContainer = styled.div`
  position: relative;
  width: 100%;
  height: 250px;

  &:hover {
    & ${CopyButton} {
      display: block;
    }
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  height: 100%;
  white-space: pre;
  overflow-wrap: normal;
  overflow: auto;
  border: 1px solid lightgray;
  background-color: #fafafa;
  border-radius: 0;
  padding: 8px;
  resize: none;
`;

const Row = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  padding: 8px;
  background-color: #f0f0f0;
  gap: 8px;
`;

const CheckboxContainer = styled(Row)`
  padding: unset;
  gap: 4px;

  & label,
  & input {
    cursor: pointer;
  }
`;

const StyledMultiSelect = styled(MultiSelect)`
  && {
    width: 200px;

    & .dropdown-heading {
      cursor: pointer;
    }

    & .dropdown-content .panel-content {
      border-radius: 0;
    }

    & .dropdown-container {
      border-radius: 0;

      &:focus-within {
        box-shadow: none;
      }
    }
  }
`;

const CloseIcon = styled(FontAwesomeIcon)`
  margin: 0 8px;
  font-size: 14px;
  cursor: pointer;
  transition: color 0.3 ease;

  &:hover {
    color: #ff4040;
  }
`;

const ArrowIcon = styled(FontAwesomeIcon)`
  font-size: 16px;
  cursor: pointer;
  transition: color 0.3 ease;

  &:hover {
    color: #808080;
  }
`;

const EMPTY_TEXT = "Nothing to export";

export default function Export(): JSX.Element {
  const dispatch = useDispatch();
  const { available } = useSelector((state) => state.groups);

  const [activeTab, setActiveTab] = useState<"JSON" | "Text" | "Markdown" | "HTML" | "CSV">("JSON");
  const [overflow, setOverflow] = useState(false);
  const [copied, setCopied] = useState(false);

  const selectOpts = useMemo(() => available.map((group) => ({ label: group.name, value: group })), [available]);
  const [selected, setSelected] = useState(selectOpts);

  const [checkbox, setCheckbox] = useState([
    { text: "Titles", checked: true },
    { text: "URLs", checked: true }
  ]);

  const [selectedGroups, setSelectedGroups] = useState(available);

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const checkedText = checkbox.filter((item) => item.checked).map((item) => item.text);
  const [keepTitles, keepURLs] = ["Titles", "URLs"].map((item) => checkedText.includes(item));

  const lineSeparator = (char: string) => `${new Array(10).fill(char).join("")}\n\n`;

  // Copy button location needs to be adjusted depending on the vertical overflow scrollbar visibility
  useEffect(() => {
    setOverflow(!!textAreaRef.current && textAreaRef.current.scrollHeight > textAreaRef.current.clientHeight);
  }, [activeTab, keepURLs, keepTitles, selectedGroups]);

  // Each time the dropdown selection changes, need to update the currently "available" group list
  useEffect(() => {
    const selectedNames = selected.map((item) => item.label);
    setSelectedGroups(available.filter((group) => selectedNames.includes(group.name)));
  }, [selected, available]);

  const getRegularText = useCallback(() => {
    if (!keepTitles && !keepURLs) return EMPTY_TEXT;

    let outputStr = "";
    selectedGroups.forEach(({ name, windows }) => {
      outputStr += `${name}\n${lineSeparator("=")}`;
      windows.forEach(({ tabs }, j) => {
        outputStr +=
          `Window ${j + 1}\n${lineSeparator("-")}` +
          (tabs
            ? tabs
                .map(
                  (t) => `${keepTitles ? `${t.title}\n` : ""}${keepURLs ? `${t.url}\n${keepTitles ? "\n" : ""}` : ""}`
                )
                .join("")
            : "");
      });
    });

    return outputStr;
  }, [keepTitles, keepURLs, selectedGroups]);

  const getMarkdownText = useCallback(() => {
    let outputStr = "";
    selectedGroups.forEach(({ name, windows }, i) => {
      outputStr += `${i > 0 ? "\n" : ""}## ${name}\n`;
      windows.forEach(({ tabs }, j) => {
        outputStr +=
          `\n### Window ${j + 1}\n\n` +
          (tabs ? tabs.map((t) => `- [${formatHtml(t.title)}](${t.url})\n`).join("") : "");
      });
    });

    if (!keepURLs) {
      outputStr = outputStr.replace(/\[(.+)\]\(.+\)/g, "$1");
    }

    return outputStr;
  }, [keepURLs, selectedGroups]);

  const getHTMLText = useCallback(() => {
    let outputStr = "";
    selectedGroups.forEach(({ name, windows }, i) => {
      outputStr += `${i > 0 ? "\n" : ""}\t\t<h1>${name}</h1>\n`;
      windows.forEach(({ tabs }, j) => {
        outputStr +=
          `\t\t<h2>Window ${j + 1}</h2>\n\t\t<ul>\n` +
          (tabs
            ? tabs
                .map(
                  (t) =>
                    `\t\t\t<li><img class="${t.url?.includes("github.com") ? "darken " : ""} tabmerger-icon" src=${
                      !t.favIconUrl ? DEFAULT_FAVICON_URL : t.favIconUrl
                    }><a href=${t.url} target="_blank" rel="noreferrer">${formatHtml(t.title)}</a></li>\n`
                )
                .join("")
            : "") +
          "\t\t</ul>\n";
      });
    });

    return (
      "<!DOCTYPE html>\n" +
      '<html lang="en">\n' +
      "\t<head>\n" +
      '\t\t<meta charset="utf-8" />\n' +
      '\t\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
      '\t\t<meta name="theme-color" content="#000000" />\n' +
      '\t\t<meta name="description" content="Merges your tabs into one location to save memory usage and increase your productivity." />\n' +
      "\t\t<title>TabMerger</title>\n" +
      "\t\t<style>\n" +
      "\t\t\tbody { font-family:helvetica,arial,sans-serif; font-size: 12px; }\n" +
      "\t\t\th1 { background:#f0f0f0; opacity: 0.75; padding:8px; font-size: 16px; }\n" +
      "\t\t\th2 { margin-left:20px; margin-top:16px; font-size: 14px; }\n" +
      "\t\t\tul { list-style-type: none; white-space: nowrap; display: flex; flex-direction: column; gap: 8px; margin: 0; }\n" +
      "\t\t\tli { display: flex; flex-direction: row; align-items: center; }\n" +
      "\t\t\ta { text-decoration: none; color: black; }\n" +
      "\t\t\ta:hover { text-decoration: underline; }\n" +
      "\t\t\t.tabmerger-icon { height: 14px; width: 14px; margin-right: 12px; }\n" +
      "\t\t\t.darken { filter: brightness(0); }\n" +
      "\t\t</style>\n" +
      "\t</head>\n" +
      "\t<body>\n" +
      outputStr +
      "\t</body>\n" +
      "</html>"
    );
  }, [selectedGroups]);

  const getCSVText = useCallback(() => {
    if (!keepTitles && !keepURLs) return EMPTY_TEXT;

    let outputStr = "Group Name,Window #,Tab Title,Tab URL\n";
    selectedGroups.forEach(({ name, windows }) => {
      windows.forEach(({ tabs }, j) => {
        outputStr += tabs
          ? tabs
              .map(
                (t) =>
                  `"${name}","Window ${j + 1}",${keepTitles ? '"' + t.title + '"' + (keepURLs ? "," : "") : ""}${
                    keepURLs ? '"' + t.url + '"' : ""
                  }\n`
              )
              .join("")
          : "";
      });
    });

    return outputStr;
  }, [keepTitles, keepURLs, selectedGroups]);

  const text = useMemo(() => {
    if (selectedGroups.length === 0) return EMPTY_TEXT;

    return activeTab === "JSON"
      ? JSON.stringify({ available: selectedGroups }, null, 4)
      : activeTab === "Text"
      ? getRegularText()
      : activeTab === "Markdown"
      ? getMarkdownText()
      : activeTab === "HTML"
      ? getHTMLText()
      : getCSVText();
  }, [activeTab, selectedGroups, getRegularText, getMarkdownText, getHTMLText, getCSVText]);

  const handleCheckboxChange = (text: string) => {
    const origCheckbox = [...checkbox];
    setCheckbox(origCheckbox.map((item) => (item.text === text ? { ...item, checked: !item.checked } : item)));
  };

  useEffect(() => {
    if (text !== EMPTY_TEXT) {
      const [type, extension] =
        activeTab === "JSON"
          ? ["application/json", ".json"]
          : activeTab === "Text"
          ? ["text/plain", ".txt"]
          : activeTab === "Markdown"
          ? ["text/markdown", ".md"]
          : activeTab === "HTML"
          ? ["text/html", ".html"]
          : ["text/csv", ".csv"];

      const newFile = new File([text], `TabMerger Export - ${new Date().toTimeString()}${extension}`, { type });

      dispatch(MODAL_CREATORS.updateExportFile(newFile));
    } else {
      dispatch(MODAL_CREATORS.updateExportFile(null));
    }
  }, [dispatch, text, activeTab]);

  return (
    <>
      <Selector opts={["JSON", "Text", "Markdown", "CSV", "HTML"]} activeTab={activeTab} setActiveTab={setActiveTab} />

      <Row>
        <Row>
          {checkbox.map(({ text, checked }) => {
            const lowerText = text.toLowerCase();

            return (
              <CheckboxContainer key={text}>
                <input
                  type="checkbox"
                  id={lowerText}
                  name={lowerText}
                  checked={activeTab === "JSON" || checked}
                  onChange={() => handleCheckboxChange(text)}
                  disabled={
                    (["Titles", "URLs"].includes(text) && ["JSON", "HTML"].includes(activeTab)) ||
                    (text === "Titles" && activeTab === "Markdown")
                  }
                />
                <label htmlFor={lowerText}>{text}</label>
              </CheckboxContainer>
            );
          })}
        </Row>

        <StyledMultiSelect
          options={selectOpts}
          value={selected}
          onChange={setSelected}
          labelledBy="Select"
          ClearIcon={<CloseIcon icon="times" />}
          ClearSelectedIcon={<CloseIcon icon="times" />}
          ArrowRenderer={({ expanded }) => <ArrowIcon icon={expanded ? "angle-up" : "angle-down"} />}
          valueRenderer={(selected) => (selected.length ? `${selected.length} Selected` : "Select Groups")}
        />
      </Row>

      <TextAreaContainer>
        <CopyButton
          icon={copied ? "check-circle" : "copy"}
          size="2x"
          $overflow={overflow}
          $copied={copied}
          title={`${copied ? "Copied" : "Copy"} to Clipboard`}
          onClick={() => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
          }}
        />

        <TextArea ref={textAreaRef} readOnly value={text} />
      </TextAreaContainer>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>
            Files are saved to your{" "}
            <StyledLink
              role="link"
              tabIndex={0}
              onClick={() => createActiveTab("chrome://downloads")}
              onKeyPress={({ key }) => key === "Enter" && createActiveTab("chrome://downloads")}
            >
              Downloads Folder
            </StyledLink>
          </p>
        </div>
      </Note>
    </>
  );
}

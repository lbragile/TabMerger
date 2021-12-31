import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MultiSelect } from "react-multi-select-component";
import styled from "styled-components";

import Selector from "./Selector";

import { useSelector } from "~/hooks/useRedux";


const TextAreaContainer = styled.div`
  position: relative;
  padding: 8px;
  width: 95%;
  height: 250px;
  margin: auto;
`;

const TextArea = styled.textarea`
  width: 100%;
  height: 100%;
  white-space: pre;
  overflow-wrap: normal;
  overflow: auto;
  border: 1px solid lightgray;
  border-radius: 0;
  padding: 8px;
  resize: none;
`;

const CopyButton = styled(FontAwesomeIcon)<{ $overflow: boolean }>`
  position: absolute;
  top: 16px;
  right: ${({ $overflow }) => ($overflow ? "32px" : "16px")};
  color: #313131;
  cursor: pointer;

  &:hover {
    color: #616161;
  }
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
  width: 175px;
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

export default function Export(): JSX.Element {
  const { available, active } = useSelector((state) => state.groups);

  const [activeTab, setActiveTab] = useState<"JSON" | "Text" | "Markdown" | "HTML" | "CSV">("JSON");
  const [overflow, setOverflow] = useState(false);

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
  }, [activeTab]);

  // Each time the dropdown selection changes, need to update the currently "available" group list
  useEffect(() => {
    const selectedNames = selected.map((item) => item.label);
    setSelectedGroups(available.filter((group) => selectedNames.includes(group.name)));
  }, [selected, available]);

  const getRegularText = useCallback(() => {
    if (!keepTitles && !keepURLs) return "Nothing to export";

    let outputStr = "";
    selectedGroups.forEach(({ name, windows }, i) => {
      outputStr += `${i > 0 ? "\n" : ""}${name}\n${lineSeparator("=")}`;
      windows.forEach(({ tabs }, j) => {
        outputStr +=
          `Window ${j + 1}\n${lineSeparator("-")}` +
          (tabs
            ? tabs
                .map(
                  (t) => `${keepTitles ? `${t.title}\n` : ""}${keepURLs ? `${t.url}\n${keepTitles ? "\n" : ""}` : ""}`
                )
                .join("")
                .replace(/^,/gm, "")
            : "");
      });
    });

    return outputStr;
  }, [keepTitles, keepURLs, selectedGroups]);

  const getMarkdownText = useCallback(() => {
    let outputStr = "";
    selectedGroups.forEach(({ name, windows }) => {
      outputStr += `\n## ${name}\n`;
      windows.forEach(({ tabs }, j) => {
        outputStr +=
          `\n### Window ${j + 1}\n\n` +
          (tabs
            ? tabs
                .map((t) => `- [${t.title}](${t.url})\n`)
                .join("")
                .replace(/^,/gm, "")
            : "");
      });
    });

    if (!keepURLs) {
      outputStr = outputStr.replace(/\[(.+)\]\(.+\)/g, "$1");
    }

    return outputStr;
  }, [keepURLs, selectedGroups]);

  const getHTMLText = useCallback(() => "HTML TEXT", []);

  const getCSVText = useCallback(() => {
    if (!keepTitles && !keepURLs) return "Nothing to export";

    let outputStr = "Group Name,Window #,Tab Title,Tab URL\n";
    selectedGroups.forEach(({ name, windows }) => {
      windows.forEach(({ tabs }, j) => {
        outputStr += tabs
          ? tabs
              .map(
                (t) =>
                  `${name},Window ${j + 1},${keepTitles ? t.title + (keepURLs ? "," : "") : ""}${
                    keepURLs ? t.url : ""
                  }\n`
              )
              .join("")
              .replace(/^,/gm, "")
          : "";
      });
    });

    return outputStr;
  }, [keepTitles, keepURLs, selectedGroups]);

  const text = useMemo(
    () =>
      activeTab === "JSON"
        ? JSON.stringify({ active, available: selectedGroups }, null, 4)
        : activeTab === "Text"
        ? getRegularText()
        : activeTab === "Markdown"
        ? getMarkdownText()
        : activeTab === "HTML"
        ? getHTMLText()
        : getCSVText(),
    [activeTab, active, selectedGroups, getRegularText, getMarkdownText, getHTMLText, getCSVText]
  );

  const handleCheckboxChange = (text: string) => {
    const origCheckbox = [...checkbox];
    setCheckbox(origCheckbox.map((item) => (item.text === text ? { ...item, checked: !item.checked } : item)));
  };

  return (
    <>
      <Selector opts={["JSON", "Text", "Markdown", "HTML", "CSV"]} activeTab={activeTab} setActiveTab={setActiveTab} />

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
                  disabled={["Titles", "URLs"].includes(text) && activeTab === "JSON"}
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
          icon="copy"
          size="2x"
          $overflow={overflow}
          title="Copy to Clipboard"
          onClick={() => navigator.clipboard.writeText(text)}
        />

        <TextArea ref={textAreaRef} readOnly value={text} />
      </TextAreaContainer>
    </>
  );
}

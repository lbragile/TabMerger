import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useRef, useState } from "react";
import { MultiSelect } from "react-multi-select-component";
import styled, { css } from "styled-components";

import type { TExportType } from "~/typings/settings";

import Checkbox from "~/components/Checkbox";
import Link from "~/components/Link";
import { ModalFooter, ModalHeader } from "~/components/Modal";
import Note from "~/components/Note";
import Selector from "~/components/Selector";
import { DOWNLOADS_URL } from "~/constants/urls";
import useFormatText from "~/hooks/useFormatText";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useSelector } from "~/hooks/useRedux";
import { CloseIcon } from "~/styles/CloseIcon";
import { Row } from "~/styles/Row";
import TextArea from "~/styles/Textarea";
import { getReadableTimestamp } from "~/utils/helper";

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
  height: 225px;

  &:hover {
    & ${CopyButton} {
      display: block;
    }
  }
`;

const StyledRow = styled(Row)`
  justify-content: space-around;
  background-color: ${({ theme }) => theme.colors.secondary};
  padding: 8px;
`;

const StyledMultiSelect = styled(MultiSelect)`
  && {
    width: 200px;

    & .dropdown-heading {
      cursor: pointer;
    }

    & .panel-content {
      border-radius: 0;
    }

    & .dropdown-container {
      border-radius: 0;

      &:focus-within {
        box-shadow: none;
      }
    }

    & .dropdown-heading,
    & .panel-content,
    & .select-item,
    & .search input {
      background-color: ${({ theme }) => theme.colors.surface};
      color: ${({ theme }) => theme.colors.onSurface};
    }
  }
`;

const ArrowIcon = styled(FontAwesomeIcon)`
  font-size: 16px;
  cursor: pointer;
  transition: color 0.3 ease;
  color: ${({ theme }) => theme.colors.onSurface};

  &:hover {
    color: #808080;
  }
`;

const EMPTY_TEXT = "Nothing to export";

export default function Export(): JSX.Element {
  const { available } = useSelector((state) => state.groups.present);

  const [fileLocationPicker, setFileLocationPicker] = useLocalStorage("fileLocationPicker", false);
  const [, setLastExport] = useLocalStorage("lastExport", "");

  const [activeTab, setActiveTab] = useState<TExportType>("json");
  const [overflow, setOverflow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportFile, setExportFile] = useState<File | null>(null);
  const [localFileLocationPicker, setLocalFileLocationPicker] = useState(false);

  useEffect(() => setLocalFileLocationPicker(fileLocationPicker), [fileLocationPicker]);

  const selectOpts = useMemo(
    () => available.slice(1).map((group) => ({ label: group.name, value: group })),
    [available]
  );

  const [selected, setSelected] = useState(selectOpts);

  const [checkbox, setCheckbox] = useState([
    { text: "Titles", checked: true },
    { text: "URLs", checked: true }
  ]);

  const [selectedGroups, setSelectedGroups] = useState(available);

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const checkedText = checkbox.filter((item) => item.checked).map((item) => item.text);
  const [keepTitles, keepURLs] = ["Titles", "URLs"].map((item) => checkedText.includes(item));

  // Copy button location needs to be adjusted depending on the vertical overflow scrollbar visibility
  useEffect(() => {
    setOverflow(!!textAreaRef.current && textAreaRef.current.scrollHeight > textAreaRef.current.clientHeight);
  }, [activeTab, keepURLs, keepTitles, selectedGroups]);

  // Each time the dropdown selection changes, need to update the currently "available" group list
  useEffect(() => {
    const selectedNames = selected.map((item) => item.label);
    setSelectedGroups(available.filter((group) => selectedNames.includes(group.name)));
  }, [selected, available]);

  const { getRegularText, getMarkdownText, getCSVText, getHTMLText } = useFormatText(
    selectedGroups,
    keepURLs,
    keepTitles
  );

  const text = useMemo(() => {
    if (selectedGroups.length === 0) return EMPTY_TEXT;

    return activeTab === "json"
      ? JSON.stringify({ available: selectedGroups }, null, 4)
      : activeTab === "text"
      ? getRegularText()
      : activeTab === "markdown"
      ? getMarkdownText()
      : activeTab === "html"
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
        activeTab === "json"
          ? ["application/json", ".json"]
          : activeTab === "text"
          ? ["text/plain", ".txt"]
          : activeTab === "markdown"
          ? ["text/markdown", ".md"]
          : activeTab === "html"
          ? ["text/html", ".html"]
          : ["text/csv", ".csv"];

      const newFile = new File([text], `TabMerger Export${extension}`, { type });

      setExportFile(newFile);
    } else {
      setExportFile(null);
    }
  }, [text, activeTab]);

  return (
    <>
      <ModalHeader title="TabMerger Export" />

      <Selector opts={["json", "text", "markdown", "csv", "html"]} activeTab={activeTab} setActiveTab={setActiveTab} />

      <StyledRow>
        <div>
          {checkbox.map(({ text, checked }) => (
            <Checkbox
              key={text}
              id={text.toLocaleLowerCase()}
              text={text}
              checked={activeTab === "json" || checked}
              setChecked={() => handleCheckboxChange(text)}
              disabled={
                (["Titles", "URLs"].includes(text) && ["json", "html"].includes(activeTab)) ||
                (text === "Titles" && activeTab === "markdown")
              }
            />
          ))}
        </div>

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
      </StyledRow>

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

        <TextArea ref={textAreaRef} $width="100%" $height="100%" readOnly value={text} />
      </TextAreaContainer>

      <Checkbox
        id="fileExportPath"
        text="Show File Location Picker"
        checked={localFileLocationPicker}
        setChecked={() => setLocalFileLocationPicker(!localFileLocationPicker)}
      />

      <Note>
        <span>
          Files can be found in your <Link href={DOWNLOADS_URL} title="Downloads Tab" />
        </span>
      </Note>

      <ModalFooter
        showSave={!!exportFile}
        saveText="Export"
        handleSave={() => {
          if (exportFile) {
            const url = URL.createObjectURL(exportFile);

            chrome.downloads.download(
              { conflictAction: "uniquify", saveAs: localFileLocationPicker, filename: exportFile.name, url },
              () => ""
            );

            setLastExport(getReadableTimestamp());
            setFileLocationPicker(localFileLocationPicker);
          }
        }}
      />
    </>
  );
}

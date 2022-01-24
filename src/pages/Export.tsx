import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { saveAs } from "file-saver";
import { useEffect, useMemo, useRef, useState } from "react";
import { MultiSelect } from "react-multi-select-component";
import styled, { css } from "styled-components";

import Link from "~/components/Link";
import ModalFooter from "~/components/ModalFooter";
import ModalHeader from "~/components/ModalHeader";
import Selector from "~/components/Selector";
import { DOWNLOADS_URL } from "~/constants/urls";
import useFormatText from "~/hooks/useFormatText";
import useLocalStorage from "~/hooks/useLocalStorage";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { setVisibility } from "~/store/actions/modal";
import { Note } from "~/styles/Note";
import TextArea from "~/styles/Textarea";
import { TExportType } from "~/typings/settings";
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
  height: 250px;

  &:hover {
    & ${CopyButton} {
      display: block;
    }
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

  const [activeTab, setActiveTab] = useState<TExportType>("json");
  const [overflow, setOverflow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportFile, setExportFile] = useState<File | null>(null);

  const [, setLastExport] = useLocalStorage("lastExport", "");

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

      const newFile = new File([text], `TabMerger Export - ${new Date().toTimeString()}${extension}`, { type });

      setExportFile(newFile);
    } else {
      setExportFile(null);
    }
  }, [text, activeTab]);

  return (
    <>
      <ModalHeader title="TabMerger Export" />

      <Selector opts={["json", "text", "markdown", "csv", "html"]} activeTab={activeTab} setActiveTab={setActiveTab} />

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
                  checked={activeTab === "json" || checked}
                  onChange={() => handleCheckboxChange(text)}
                  disabled={
                    (["Titles", "URLs"].includes(text) && ["json", "html"].includes(activeTab)) ||
                    (text === "Titles" && activeTab === "markdown")
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

        <TextArea ref={textAreaRef} $width="100%" $height="100%" readOnly value={text} />
      </TextAreaContainer>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <span>Files are saved to your</span> <Link href={DOWNLOADS_URL} title="Downloads Folder" />
        </div>
      </Note>

      <ModalFooter
        showSave={!!exportFile}
        saveText="Export"
        handleSave={() => {
          if (exportFile) {
            saveAs(exportFile);
            setLastExport(getReadableTimestamp());
            dispatch(setVisibility(false));
          }
        }}
      />
    </>
  );
}

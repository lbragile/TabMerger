import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useRef, useState } from "react";
import { MultiSelect } from "react-multi-select-component";
import styled, { css } from "styled-components";

import Link from "./Link";
import Selector from "./Selector";

import { DOWNLOADS_URL } from "~/constants/urls";
import useFormatText from "~/hooks/useFormatText";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import { updateExportFile } from "~/store/actions/modal";
import { Note } from "~/styles/Note";
import TextArea from "~/styles/Textarea";

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

  const [activeTab, setActiveTab] = useState<"JSON" | "Text" | "Markdown" | "HTML" | "CSV">("JSON");
  const [overflow, setOverflow] = useState(false);
  const [copied, setCopied] = useState(false);

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

      dispatch(updateExportFile(newFile));
    } else {
      dispatch(updateExportFile(null));
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

        <TextArea ref={textAreaRef} $width="100%" $height="100%" readOnly value={text} />
      </TextAreaContainer>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>Files are saved to your</p> <Link href={DOWNLOADS_URL} title="Downloads Folder" />
        </div>
      </Note>
    </>
  );
}

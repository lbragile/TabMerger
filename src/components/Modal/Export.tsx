import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import { useSelector } from "../../hooks/useRedux";

import Selector from "./Selector";

const TextAreaContainer = styled.div`
  position: relative;
  padding: 8px;
  width: 95%;
  height: 300px;
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

export default function Export(): JSX.Element {
  const { available, active } = useSelector((state) => state.groups);

  const [activeTab, setActiveTab] = useState<"JSON" | "Text" | "Markdown" | "HTML" | "CSV">("JSON");
  const [overflow, setOverflow] = useState(false);

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // Copy button location needs to be adjusted depending on the vertical overflow scrollbar visibility
  useEffect(() => {
    setOverflow(!!textAreaRef.current && textAreaRef.current.scrollHeight > textAreaRef.current.clientHeight);
  }, [activeTab]);

  const text = useMemo(
    () =>
      activeTab === "JSON"
        ? JSON.stringify({ active, available }, null, 4)
        : activeTab === "Text"
        ? available[active.index].windows
            .map(({ tabs }) => tabs?.map((t, i) => `${t?.title}\n${t?.url}${i < tabs?.length - 1 ? "\n\n" : ""}`))
            .join("")
            .replace(/^,/gm, "")
        : activeTab === "Markdown"
        ? available[active.index].windows
            .map(({ tabs }) => tabs?.map((t, i) => `- [${t?.title}](${t?.url})${i < tabs?.length - 1 ? "\n" : ""}`))
            .join("")
            .replace(/^,/gm, "")
        : activeTab === "HTML"
        ? "HTML TEXT"
        : "Title,URL\n" +
          available[active.index].windows
            .map(({ tabs }) => tabs?.map((t, i) => `"${t?.title}","${t?.url}"${i < tabs?.length - 1 ? "\n" : ""}`))
            .join("")
            .replace(/^,/gm, ""),
    [activeTab, active, available]
  );

  return (
    <>
      <Selector opts={["JSON", "Text", "Markdown", "HTML", "CSV"]} activeTab={activeTab} setActiveTab={setActiveTab} />

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

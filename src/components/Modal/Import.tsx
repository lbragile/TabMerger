import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Dispatch, SetStateAction, useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import styled, { css } from "styled-components";

import Selector from "./Selector";

import { Note } from "~/styles/Note";

const DropZone = styled.div<{ $isRejected: boolean; $isAccepted: boolean }>`
  height: 300px;
  width: 400px;
  margin: auto;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 16px;
  cursor: pointer;
  ${({ $isRejected, $isAccepted }) => css`
    border: 1px dashed ${$isAccepted ? "green" : $isRejected ? "red" : "grey"};
    background-color: ${$isAccepted ? "#ccffcc" : $isRejected ? "#ffcccc" : "#f0f0f0"};
  `}
`;

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
  align-items: center;
`;

const StyledTextArea = styled.textarea`
  height: 350px;
  width: 400px;
  padding: 8px;
  resize: none;
  margin: auto;
  white-space: pre;
  overflow-wrap: normal;
`;

const UploadIcon = styled(FontAwesomeIcon)`
  &:hover {
    color: #666;
  }
`;

const ErrorMessage = styled.p`
  font-weight: bold;
  color: red;
  text-align: center;
`;

const ERROR_TEXT = "Something is wrong with this file, please try another one";

interface IImport {
  uploadedText: string;
  setUploadedText: Dispatch<SetStateAction<string>>;
}

export default function Import({ uploadedText, setUploadedText }: IImport): JSX.Element {
  const [activeTab, setActiveTab] = useState<"File" | "Text">("File");

  // Get uploaded text & move to the next screen for confirmation
  const onDropAccepted = useCallback(
    async ([file]: File[]) => {
      const { type } = file;
      const text =
        type === "application/json" ? JSON.stringify(await new Response(file).json(), null, 4) : await file.text();

      setUploadedText(text);
      setActiveTab("Text");
    },
    [setUploadedText]
  );

  const { getRootProps, getInputProps, isDragActive, isDragAccept, isDragReject, fileRejections } = useDropzone({
    onDropAccepted,
    accept: [
      "application/json",
      "text/plain",
      ".md",
      "text/markdown",
      ".csv",
      "application/vnd.ms-excel",
      "text/csv",
      ""
    ],
    multiple: false,
    maxFiles: 1,
    maxSize: 25e6
  });

  return (
    <>
      <Selector opts={["File", "Text"]} activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === "File" ? (
        <>
          <DropZone {...getRootProps()} $isRejected={isDragReject} $isAccepted={isDragAccept}>
            <input {...getInputProps()} />

            <Column>
              {isDragActive && isDragAccept ? (
                <>
                  <FontAwesomeIcon icon="check-circle" size="2x" color="green" />
                  <p>File looks promising... drop it to proceed</p>
                </>
              ) : isDragActive && isDragReject ? (
                <>
                  <FontAwesomeIcon icon="times-circle" size="2x" color="red" />
                  <p>{ERROR_TEXT}</p>
                </>
              ) : (
                <>
                  <p>Drop files here to upload</p>
                  <h3>OR</h3>
                  <UploadIcon icon="upload" size="3x" />

                  <br />
                  <p>
                    Accepted files: <b>.json</b>, <b>.txt</b>, <b>.md</b>, <b>.csv</b>
                  </p>

                  <p>
                    Maximum upload size: <b>25 MB</b>
                  </p>
                </>
              )}
            </Column>
          </DropZone>

          {!isDragActive && fileRejections.length > 0 && <ErrorMessage>{ERROR_TEXT}</ErrorMessage>}

          <Note>
            <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

            <p>Upon successful upload, you will have a chance to confirm!</p>
          </Note>
        </>
      ) : (
        <StyledTextArea
          placeholder="Enter JSON, markdown, CSV, or plain text here..."
          value={uploadedText}
          onChange={(e) => setUploadedText(e.target.value)}
        />
      )}
    </>
  );
}

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import styled, { css } from "styled-components";

import type { TImportType } from "~/typings/settings";

import Note from "~/components/Note";
import { Column } from "~/styles/Column";
import { Message } from "~/styles/Message";

const DropZone = styled.div<{ $isRejected: boolean; $isAccepted: boolean }>`
  height: 300px;
  width: 400px;
  margin: auto;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 16px;
  cursor: pointer;
  ${({ $isRejected, $isAccepted, theme }) => css`
    border: 1px dashed ${$isAccepted ? "green" : $isRejected ? "red" : "grey"};
    background-color: ${$isAccepted ? "#ddffdd" : $isRejected ? "#ffdddd" : theme.colors.secondary};
  `}
`;

const StyledColumn = styled(Column)`
  gap: 8px;
  justify-content: center;
  align-items: center;
`;

const UploadIcon = styled(FontAwesomeIcon)`
  &:hover {
    color: #666;
  }
`;

const UPLOAD_FILE_ERROR = "Something is wrong with this file, please try another one";

interface IFile {
  setCurrentText: (arg: string) => void;
  setActiveTab: (arg: "File" | "Text") => void;
  setImportType: (arg: TImportType) => void;
}

export default function File({ setCurrentText, setActiveTab, setImportType }: IFile): JSX.Element {
  // Get uploaded text & move to the next screen for confirmation
  const onDropAccepted = useCallback(
    async ([file]: File[]) => {
      const { name } = file;

      const type = /\.json$/.test(name)
        ? "json"
        : /\.csv$/.test(name)
        ? "csv"
        : /\.txt$/.test(name)
        ? "text"
        : "markdown";

      const text = type === "json" ? JSON.stringify(await new Response(file).json(), null, 4) : await file.text();

      setImportType(type);
      setCurrentText(text);
      setActiveTab("Text");
    },
    [setImportType, setCurrentText, setActiveTab]
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
      <DropZone {...getRootProps()} $isRejected={isDragReject} $isAccepted={isDragAccept}>
        <input {...getInputProps()} />

        <StyledColumn>
          {isDragActive && isDragAccept ? (
            <>
              <FontAwesomeIcon icon="check-circle" size="2x" color="green" />
              <Message $recent>File looks promising... drop it to proceed</Message>
            </>
          ) : isDragActive && isDragReject ? (
            <>
              <FontAwesomeIcon icon="times-circle" size="2x" color="red" />
              <Message $error>{UPLOAD_FILE_ERROR}</Message>
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
        </StyledColumn>
      </DropZone>

      {!isDragActive && fileRejections.length > 0 && <Message $error>{UPLOAD_FILE_ERROR}</Message>}

      <Note>
        <p>Upon successful upload, you will have a chance to confirm!</p>
      </Note>
    </>
  );
}

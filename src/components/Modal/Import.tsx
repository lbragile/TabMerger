import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import styled, { css } from "styled-components";

import Selector from "./Selector";

import { useDebounce } from "~/hooks/useDebounce";
import { useDispatch, useSelector } from "~/hooks/useRedux";
import MODAL_CREATORS from "~/store/actions/modal";
import { IGroupItemState } from "~/store/reducers/groups";
import { TImportType } from "~/store/reducers/modal";
import { Note } from "~/styles/Note";
import { pluralize } from "~/utils/helper";

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
  height: 300px;
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

const Message = styled.p<{ $error?: boolean }>`
  font-weight: bold;
  color: ${({ $error }) => ($error ? "red" : "green")};
  text-align: center;
`;

const UPLOAD_FILE_ERROR = "Something is wrong with this file, please try another one";
const IMPORT_TEXT_ERROR = "This text does not match the expected import format";

export default function Import(): JSX.Element {
  const dispatch = useDispatch();

  const {
    import: { type: importType, formatted }
  } = useSelector((state) => state.modal);

  const [activeTab, setActiveTab] = useState<"File" | "Text">("File");
  const [currentText, setCurrentText] = useState("");

  const debouncedCurrentText = useDebounce(currentText, 250);

  // Reset the uploaded text & formatted groups if the activeTab is changed
  useEffect(() => {
    if (activeTab === "File") {
      setCurrentText("");
      dispatch(MODAL_CREATORS.updateImportFormattedGroups([]));
    }
  }, [dispatch, activeTab]);

  const formatPlain = useCallback((text: string) => {
    const groups: IGroupItemState[] = [];

    const matchStr = text.match(/(.+\n={3,}\n\n(.+\n-{3,}\n\n(.+\n.+:\/\/.+(\n\n)?)+)+)+/g)?.[0];
    const groupsArr = matchStr?.split(/(?<=.+?:\/\/.+?\n)(\n(?=.+?\n=+\n))/g).filter((item) => item !== "\n");

    groupsArr?.forEach((item) => {
      const infoArr = item.split("\n").filter((x) => x);
      const newEntry: IGroupItemState = {
        name: infoArr[0],
        id: nanoid(10),
        color: "rgb(128 128 128)",
        updatedAt: Date.now(),
        windows: [],
        permanent: false,
        info: "0T | 0W"
      };

      const matches = infoArr
        .slice(2)
        .join("\n")
        .matchAll(/.+\n-+(?<tabsStr>(\n.+?\n.+?:\/\/.+)+)/g);

      for (const match of matches) {
        const { tabsStr } = match.groups as { tabsStr: string };
        const tabs = tabsStr.split(/(?<=.+:\/\/.+)\n/g).map((item) => {
          const [title, url] = item.split("\n").filter((x) => x);

          return {
            title,
            url,
            favIconUrl: `https://s2.googleusercontent.com/s2/favicons?domain_url=${url}`,
            active: false,
            audible: false,
            autoDiscardable: true,
            discarded: false,
            groupId: -1,
            highlighted: false,
            incognito: false,
            index: 0,
            pinned: false,
            selected: false,
            windowId: 1
          };
        });

        newEntry.windows.push({
          alwaysOnTop: false,
          focused: false,
          incognito: false,
          state: "maximized",
          type: "normal",
          starred: false,
          tabs
        });
      }

      groups.push(newEntry);
    });

    return groups;
  }, []);

  useEffect(() => {
    if (debouncedCurrentText !== "") {
      let groups: IGroupItemState[] | null = null;

      if (importType === "json") {
        try {
          groups = JSON.parse(debouncedCurrentText).available as IGroupItemState[];

          // Make sure first group is not a permanent group (since `Now Open` should be the only permanent group)
          groups[0].id = nanoid(10);
          groups[0].permanent = false;
          groups[0].windows.forEach((w) => (w.focused = false));
        } catch (err) {
          // Do nothing
        }
      } else if (importType === "plain") {
        groups = formatPlain(debouncedCurrentText);
      } else if (importType === "markdown") {
        // Transform the markdown into plain text format, then use the existing parser to create groups
        const transformedGroupName = debouncedCurrentText.replace(/##\s(.+)?\n(?=\n###\s.+?\n)/g, "$1\n===\n");
        const transformedWindowName = transformedGroupName.replace(/###\s(.+)?\n/g, "$1\n---\n");
        const transformedTabs = transformedWindowName.replace(/-\s\[(.+)?\]\((.+)?\)\n?\n?/g, "$1\n$2\n\n");
        groups = formatPlain(transformedTabs);
      } else {
        // Transform the CSV into plain text format, then use the existing parser to create groups
        let [transformedStr, currentGroupName, currentWindowName] = ["", "", ""];

        const csvData = debouncedCurrentText
          .split("\n")
          .slice(1)
          .filter((x) => x);

        csvData.forEach((row) => {
          const [groupName, windowName, title, url] = row.split(/,(?=".+?")/g).map((item) => item.replace(/"/g, ""));

          const windowTitle = `${windowName}\n---\n\n`;

          // When a groupName mismatch occurs can automatically add the windowName as well ...
          // However if there is no groupName mismatch, then must check for windowName mismatch
          if (groupName !== currentGroupName) {
            currentGroupName = groupName;
            transformedStr += `${groupName}\n===\n\n${windowTitle}`;
          } else if (windowName !== currentWindowName) {
            currentWindowName = windowName;
            transformedStr += `${windowTitle}`;
          }

          transformedStr += `${title}\n${url}\n\n`;
        });

        groups = transformedStr === "" ? [] : formatPlain(transformedStr);
      }

      if (groups) {
        dispatch(MODAL_CREATORS.updateImportFormattedGroups(groups));
      }
    }
  }, [dispatch, debouncedCurrentText, importType, formatPlain]);

  // Get uploaded text & move to the next screen for confirmation
  const onDropAccepted = useCallback(
    async ([file]: File[]) => {
      const { name } = file;
      const type = /\.json$/.test(name)
        ? "json"
        : /\.csv$/.test(name)
        ? "csv"
        : /\.txt$/.test(name)
        ? "plain"
        : "markdown";

      const text = type === "json" ? JSON.stringify(await new Response(file).json(), null, 4) : await file.text();

      dispatch(MODAL_CREATORS.updateImportType(type));
      setCurrentText(text);
      setActiveTab("Text");
    },
    [dispatch]
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
                  <Message>File looks promising... drop it to proceed</Message>
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
            </Column>
          </DropZone>

          {!isDragActive && fileRejections.length > 0 && <Message $error>{UPLOAD_FILE_ERROR}</Message>}

          <Note>
            <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

            <p>Upon successful upload, you will have a chance to confirm!</p>
          </Note>
        </>
      ) : (
        <>
          <StyledTextArea
            placeholder="Paste JSON, markdown, CSV, or plain text here..."
            value={currentText}
            onChange={({ target: { value } }) => {
              // If value changed due to a paste event, need to re-compute the upload type

              let type: TImportType = "json";
              if (/.+?\n={3,}\n/.test(value)) type = "plain";
              else if (/\n?\n?#{2,3}.+?\n/.test(value)) type = "markdown";
              else if (/(".+?",?){4}\n/.test(value)) type = "csv";

              if (type !== importType) dispatch(MODAL_CREATORS.updateImportType(type));

              setCurrentText(value);
            }}
          />

          {currentText.replace(/\n/g, "") !== "" && formatted.length === 0 ? (
            <Message $error>{IMPORT_TEXT_ERROR}</Message>
          ) : (
            currentText.replace(/\n/g, "") !== "" && (
              <Message>
                Can import {formatted.length} matching {pluralize(formatted.length, "group")}
              </Message>
            )
          )}

          <Note>
            <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

            <p>Each tab must have an associated URL (eg. https://www.google.com)</p>
          </Note>
        </>
      )}
    </>
  );
}

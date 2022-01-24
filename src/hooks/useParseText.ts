import { nanoid } from "nanoid";
import { useCallback, useEffect } from "react";

import { IGroupItemState } from "~/store/reducers/groups";
import { TImportType } from "~/typings/settings";
import { createGroup, createTabFromTitleAndUrl, createWindowWithTabs } from "~/utils/helper";

interface IParseText {
  debouncedText: string;
  importType: TImportType;
  setImportFile: (arg: IGroupItemState[]) => void;
}

export default function useParseText({ debouncedText, importType, setImportFile }: IParseText) {
  const formatPlain = useCallback((text: string) => {
    const groups: IGroupItemState[] = [];

    const matchStr = text.match(/(.+\n+={3,}\n+(.+\n+-{3,}\n+((?!.*:\/\/).+\n+.+:\/\/.+\n*)+)+)+/g)?.[0];
    const groupsArr = matchStr?.split(/(?<=.+?:\/\/.+?\n*)(\n(?=.+?\n+=+\n+))/g).filter((item) => item !== "\n");

    groupsArr?.forEach((item) => {
      const infoArr = item.split("\n").filter((x) => x);
      const newEntry = createGroup(nanoid(10), infoArr[0]);

      const matches = infoArr
        .slice(2)
        .join("\n")
        .matchAll(/(?<windowName>(.+))\n+-+(?<tabsStr>(\n+.+?\n+.+?:\/\/.+)+)/g);

      for (const match of matches) {
        const { tabsStr, windowName } = match.groups as { tabsStr: string; windowName: string };

        const tabs = tabsStr.split(/(?<=.+:\/\/.+)\n+/g).map((item) => {
          const [title, url] = item.split("\n").filter((x) => x);

          return createTabFromTitleAndUrl(title, url);
        });

        newEntry.windows.push(createWindowWithTabs(tabs, windowName));
      }

      groups.push(newEntry);
    });

    return groups;
  }, []);

  useEffect(() => {
    if (debouncedText !== "") {
      let groups: IGroupItemState[] | null = null;

      if (importType === "json") {
        try {
          groups = JSON.parse(debouncedText).available as IGroupItemState[];

          // Make sure first group is not a permanent group (since `Now Open` should be the only permanent group)
          groups[0].id = nanoid(10);
          groups[0].permanent = false;
          groups[0].windows.forEach((w) => (w.focused = false));
        } catch (err) {
          // Clear the formatted groups if an invalid upload is detected
          setImportFile([]);
        }
      } else if (importType === "text") {
        groups = formatPlain(debouncedText);
      } else if (importType === "markdown") {
        // Transform the markdown into plain text format, then use the existing parser to create groups
        const transformedGroupName = debouncedText.replace(/##\s(.+)?\n(?=\n*###\s.+?\n+)/g, "$1\n===\n");
        const transformedWindowName = transformedGroupName.replace(/###\s(.+)?\n+/g, "$1\n---\n");
        const transformedTabs = transformedWindowName.replace(/-\s\[(.+)?\]\((.+)?\)\n*/g, "$1\n$2\n\n");
        groups = formatPlain(transformedTabs);
      } else {
        // Transform the CSV into plain text format, then use the existing parser to create groups
        let [transformedStr, currentGroupName, currentWindowName] = ["", "", ""];

        const csvData = debouncedText
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
        setImportFile(groups);
      }
    }
  }, [debouncedText, importType, formatPlain, setImportFile]);
}

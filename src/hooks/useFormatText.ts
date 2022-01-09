import { useCallback } from "react";

import { DEFAULT_FAVICON_URL } from "~/constants/urls";
import { IGroupItemState } from "~/store/reducers/groups";
import { ISyncDataItem } from "~/store/reducers/modal";
import { formatHtml } from "~/utils/helper";

const EMPTY_TEXT = "Nothing to export";

export default function useFormatText(
  selectedGroups: (IGroupItemState | ISyncDataItem)[],
  keepURLs = true,
  keepTitles = true
) {
  const lineSeparator = (char: string) => `${new Array(10).fill(char).join("")}\n\n`;

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
                      t.url ? `https://s2.googleusercontent.com/s2/favicons?domain_url=${t.url}` : DEFAULT_FAVICON_URL
                    }
                    ><a href=${t.url} target="_blank" rel="noreferrer">${formatHtml(t.title)}</a></li>\n`
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

  return { getRegularText, getMarkdownText, getHTMLText, getCSVText };
}
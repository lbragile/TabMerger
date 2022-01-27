/* eslint-disable @typescript-eslint/no-var-requires */
const { execSync } = require("child_process");
const fs = require("fs");

/**
 * @see https://stackoverflow.com/questions/14618022/how-does-git-log-since-count
 */
const afterDate = "2022-01-26T00:00:00-08:00";

const data = execSync(`git log --after=${afterDate}`, { encoding: "utf-8" });
const latestTag = execSync("git describe --tags --abbrev=0", { encoding: "utf-8" }).replace("\n", "");

const commitArr: string[] = data
  .replace(/(?<=commit\s\w{40}\n)(?:.+\n){2,3}/g, "")
  .split(/commit\s/)
  .filter((x: string) => x !== "");

function addMarkdownEntries(type: keyof typeof keepAChangeLog, title: string) {
  if (keepAChangeLog[type].length > 0) {
    markdownStr += `\n${title}\n\n`;

    keepAChangeLog[type].forEach((item) => {
      const baseURL = `https://github.com/lbragile/TabMerger/${
        item.type === "pr" ? "pull" : item.type === "issue" ? "issues" : "commit"
      }`;

      const id = item.type === "pr" ? `!${item.id}` : item.type === "issue" ? `#${item.id}` : item.hash.slice(0, 7);
      const path = item.type === "regular" ? item.hash : item.id;
      markdownStr += `- ${item.subject[0].toUpperCase() + item.subject.slice(1)} [\`${id}\`](${baseURL}/${path})\n`;
    });
  }
}

const keepAChangeLog: Record<
  "added" | "fixed" | "changed" | "removed",
  { type: "pr" | "issue" | "regular"; hash: string; subject: string; id?: string }[]
> = {
  added: [],
  fixed: [],
  changed: [],
  removed: []
};

const getRegExp = (ending: string) => new RegExp(`(feat|fix|perf|refactor|test)(\\(.+?\\))?:\\s${ending}`, "i");

const insertIntoChangeLog = (type: keyof typeof keepAChangeLog, commit: string) => {
  const hash = commit.slice(0, 40);

  const result = commit.match(/((feat|fix|perf|refactor|test)(\(.+?\))?:\s.+?\s(?<subject>.+))\n/);
  const { subject } = result?.groups ?? {};

  if (commit.includes("Merge pull request #")) {
    const result = commit.match(/Merge pull request #(?<id>\d+)\s/);
    const { id } = result?.groups ?? {};
    keepAChangeLog[type].push({ type: "pr", hash, subject, id });
  } else if (commit.includes("Refs: #")) {
    const result = commit.match(/Refs: #(?<id>\d+)\s/);
    const { id } = result?.groups ?? {};
    keepAChangeLog[type].push({ type: "issue", hash, subject, id });
  } else {
    keepAChangeLog[type].push({ type: "regular", hash, subject });
  }
};

function formatByteStr(bytes: number) {
  const [kiloBytes, megaBytes, gigaBytes] = [1, 2, 3].map((exp) => 1e3 ** exp);

  const outputStr =
    bytes < kiloBytes
      ? bytes + " B"
      : bytes < megaBytes
      ? (bytes / kiloBytes).toFixed(2) + " KB"
      : bytes < gigaBytes
      ? (bytes / megaBytes).toFixed(2) + " MB"
      : (bytes / gigaBytes).toFixed(2) + " GB";

  return outputStr;
}

commitArr.forEach((commit) => {
  if (getRegExp("add(ed)?").test(commit)) {
    insertIntoChangeLog("added", commit);
  } else if (getRegExp("fix(ed)?").test(commit)) {
    insertIntoChangeLog("fixed", commit);
  } else if (getRegExp("(changed?|adjust(ed)?|updated?|upgraded?)").test(commit)) {
    insertIntoChangeLog("changed", commit);
  } else if (getRegExp("removed?").test(commit)) {
    insertIntoChangeLog("removed", commit);
  }
});

const dateStr = new Date().toDateString().slice(4);
let markdownStr = `\n## [Unreleased](https://github.com/lbragile/TabMerger/compare/${latestTag}...HEAD) (${dateStr})\n`;

addMarkdownEntries("added", "### Added");
addMarkdownEntries("fixed", "### Fixed");
addMarkdownEntries("changed", "### Changed");
addMarkdownEntries("removed", "### Removed");

const CHANGELOG_PATH = "CHANGELOG.md";
fs.readFile(CHANGELOG_PATH, "utf8", function (err: Error, data: string) {
  if (err) return console.error(err);

  const startComment = "<!-- add-changelog-start -->";
  const endComment = "<!-- add-changelog-end -->";
  const replaceText = new RegExp(`(?<=${startComment})(.*)(?=${endComment})`, "s");
  const match = data.match(replaceText);

  if (match) {
    const text = data.replace(replaceText, markdownStr);

    fs.writeFile(CHANGELOG_PATH, text, (err: Error) => {
      if (err) return console.error(err);
      console.info(`[Auto Changelog]: Success 🎉 - wrote ${formatByteStr(markdownStr.length)}`);
    });
  } else {
    console.info(`[Auto Changelog]: Failure ❌ - could not find start/end comments`);
  }
});

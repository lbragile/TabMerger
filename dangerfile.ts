import { markdown, danger, warn, fail } from "danger";

const BIG_PR_THRESHOLD = 1000;
const LONG_COMMIT_MESSAGE_THRESHOLD = 125;

function generateCollapsibleList(items: string[], summary: string): string {
  return `
  <details>
    <summary>${summary}</summary>
    <ul>
      ${items.map((item) => `<li>${item}</li>`).join("\n")}
    </ul>
  </details>
  `;
}

(async function () {
  const packageChanged = danger.git.modified_files.includes("package.json");
  const lockfileChanged = danger.git.modified_files.includes("pnpm-lock.yaml");
  const PACKAGE_CHECK_MESSAGE = `Changes found in package.json, but not in pnpm-lock.yaml - <i>'Forgot to run \`pnpm i\`?'</i>`;

  const linesAdded = danger.github.pr.additions;
  const linesDeleted = danger.github.pr.deletions;
  const BIG_PR_MESSAGE = `Big PR (# added: <b>${linesAdded}</b>, # deleted: <b>${linesDeleted}</b>), please keep your PR small to make it easier to review`;

  const malformedCommits = danger.git.commits.filter((commit) => {
    const subject = commit.message.split("\n")[0];

    return (
      (!subject.match(/^(feat|fix|build|chore|ci|style|refactor|perf|test|docs):/i) && !subject.includes("Test")) ||
      subject.length > LONG_COMMIT_MESSAGE_THRESHOLD
    );
  });

  const MALFORMED_COMMIT_MESSAGE = `
  Some commit messages do not match the expected format (helps us generate changelogs).
  <br />
  <br />
  <details>
      <summary>Violating Commits</summary>
      <ul>
        ${malformedCommits
          .map((item) => `<li>${item.message.split("\n")[0]} (${item.sha.slice(0, 7)})</li>`)
          .join("\n")}
      </ul>
  </details>
  See ${danger.utils.href(
    "https://www.conventionalcommits.org/en/v1.0.0/",
    "Conventional Commits"
  )} for expected formatting.
  `;

  const filesChanged = [...danger.git.modified_files, ...danger.git.created_files, ...danger.git.deleted_files];

  const fileSizeMapper: Record<"filename" | "base" | "current" | "diff" | "percent", string>[] = [];
  for (const file of filesChanged) {
    const { before, after } = await danger.git.diffForFile(file);

    const unMinifiedSizeDiffInBytes = after.length - before.length;
    const percentageChanged = (unMinifiedSizeDiffInBytes * 100) / before.length;

    fileSizeMapper.push({
      filename: file,
      base: `${before.length * 1e3} KB`,
      current: `${after.length * 1e3} KB`,
      diff: `${unMinifiedSizeDiffInBytes * 1e3}KB`,
      percent: `${percentageChanged}%`
    });
  }

  // MESSAGES

  if (packageChanged && !lockfileChanged) warn(PACKAGE_CHECK_MESSAGE);

  if (linesAdded + linesDeleted > BIG_PR_THRESHOLD && !lockfileChanged) warn(BIG_PR_MESSAGE);

  if (malformedCommits.length > 0) fail(MALFORMED_COMMIT_MESSAGE);

  markdown(`
  ## PR Snapshot
  
  Comparing: ${danger.git.base.slice(0, 7)}...${danger.git.head.slice(0, 7)}
  
  ${generateCollapsibleList(danger.git.modified_files, "Changed Files")}

  ${generateCollapsibleList(danger.git.created_files, "Created Files")}

  ${generateCollapsibleList(danger.git.deleted_files, "Deleted Files")}
  `);

  markdown(`
  ## File Size Changes

  Comparing: ${danger.git.base.slice(0, 7)}...${danger.git.head.slice(0, 7)}

  | Filename | Base | Current | +/- |  %  |
  |---------:|:----:|:-------:|:---:|:---:|
  ${fileSizeMapper
    .map((item) => `| ${item.filename} | ${item.base} | ${item.current} | ${item.diff} | ${item.percent} |`)
    .join("\n")}
  `);
})();

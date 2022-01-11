import { markdown, danger, warn, fail } from "danger";

markdown(`
## PR Snapshot

Comparing: ${danger.git.base.slice(0, 8)}...${danger.git.head.slice(0, 8)}

### Changed Files:
<details>
    <summary>See Details</summary>
    <ul>
      ${danger.git.modified_files.map((item) => `<li>${item}</li>`).join("\n")}
    </ul>
</details>

### Created Files:
<details>
    <summary>See Details</summary>
    <ul>
      ${danger.git.created_files.map((item) => `<li>${item}</li>`).join("\n")}
    </ul>
</details>

### Deleted Files:
<details>
    <summary>See Details</summary>
    <ul>
      ${danger.git.deleted_files.map((item) => `<li>${item}</li>`).join("\n")}
    </ul>
</details>
`);

const linesAdded = danger.github.pr.additions;
const linesDeleted = danger.github.pr.deletions;
const BIG_PR_THRESHOLD = 1000;
const LONG_COMMIT_MESSAGE_THRESHOLD = 125;

const packageChanged = danger.git.modified_files.includes("package.json");
const lockfileChanged = danger.git.modified_files.includes("pnpm-lock.yaml");

const malformedCommits = danger.git.commits.filter((commit) => {
  const subject = commit.message.split("\n")[0];

  return (
    (!subject.match(/^(feat|fix|build|chore|ci|style|refactor|perf|test|docs):/i) && !subject.includes("Test")) ||
    subject.length > LONG_COMMIT_MESSAGE_THRESHOLD
  );
});

const PACKAGE_CHECK_MESSAGE = `Changes found in package.json, but not in pnpm-lock.yaml - <i>'Forgot to run \`pnpm i\`?'</i>`;

const BIG_PR_MESSAGE = `Big PR (# added: <b>${linesAdded}</b>, # deleted: <b>${linesDeleted}</b>), please keep your PR small to make it easier to review`;

const MALFORMED_COMMIT_MESSAGE = `
Some commit messages do not match the expected format (helps us generate changelogs).
<br />
<details>
    <summary>Violating Commits</summary>
    <ul>
      ${malformedCommits.map((item) => `<li>${item.message.split("\n")[0]} (${item.sha.slice(0, 8)})</li>`).join("\n")}
    </ul>
</details>
<br />
See <a href='https://www.conventionalcommits.org/en/v1.0.0/'>Conventional Commits</a> for expected formatting.
`;

if (packageChanged && !lockfileChanged) warn(PACKAGE_CHECK_MESSAGE);

if (linesAdded + linesDeleted > BIG_PR_THRESHOLD) warn(BIG_PR_MESSAGE);

if (malformedCommits.length > 0) fail(MALFORMED_COMMIT_MESSAGE);

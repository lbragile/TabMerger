import { markdown, danger, warn, fail } from "danger";

markdown(`
## PR Snapshot

### Changed Files:
- ${danger.git.modified_files.join("\n- ")}

### Created Files:
- ${danger.git.created_files.join("\n- ")}

### Deleted Files:
- ${danger.git.deleted_files.join("\n- ")}
`);

const linesAdded = danger.github.pr.additions;
const linesDeleted = danger.github.pr.deletions;
const BIG_PR_THRESHOLD = 1000;
const LONG_COMMIT_MESSAGE_THRESHOLD = 125;

const packageChanged = danger.git.modified_files.includes("package.json");
const lockfileChanged = danger.git.modified_files.includes("pnpm-lock.json");

const malformedCommits = danger.git.commits.filter(
  (commit) =>
    !commit.message.match(/^(feat|fix|build|chore|ci|style|refactor|perf|test|docs):/i) ||
    commit.message.length > LONG_COMMIT_MESSAGE_THRESHOLD
);

const PACKAGE_CHECK_MESSAGE = `Changes were made to package.json, but not to pnpm-lock.json - <i>'Perhaps you need to run \`pnpm i\`?'</i>`;

const BIG_PR_MESSAGE = `Big PR (#added: ${linesAdded}, #deleted: ${linesDeleted}), please keep your PR small to make it easier to review`;

const MALFORMED_COMMIT_MESSAGE = `
Some commit messages do not match the expected format (helps us generate changelogs).\n\n
Violating commits:\n
- ${malformedCommits.map((item) => `${item.message} (\`${item.sha}\`)`).join("\n- ")}\n\n
See <a href='https://www.conventionalcommits.org/en/v1.0.0/'>Conventional Commits</a> for proper formatting.
`;

if (packageChanged && !lockfileChanged) warn(PACKAGE_CHECK_MESSAGE);

if (linesAdded + linesDeleted > BIG_PR_THRESHOLD) warn(BIG_PR_MESSAGE);

if (malformedCommits.length > 0) fail(MALFORMED_COMMIT_MESSAGE);

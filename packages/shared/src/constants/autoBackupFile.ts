/**
 * "Also save a file to this computer" (automatic backups): the folder and the file name the user
 * types become a path on their disk, so everything here treats them as untrusted input. The
 * browser only lets an extension write INSIDE its Downloads folder, so the folder is a path
 * relative to Downloads. Pure functions: the popup validates as the user types, and the
 * background worker validates again what it reads from storage before every write.
 */

export const DEFAULT_BACKUP_FILE_FOLDER = 'TabMerger';
export const DEFAULT_BACKUP_FILE_PATTERN = 'TabMerger backup {date} {time}';
/** Off until the user turns it on: it needs a permission the user must grant. */
export const DEFAULT_BACKUP_FILE_ENABLED = false;
export const BACKUP_FILE_EXTENSION = '.json';
/** The browser permission the file copy needs. Optional: requested when the user turns the option on. */
export const BACKUP_FILE_PERMISSION = 'downloads';

/** The placeholders a file name pattern may contain, with what each becomes. */
export const BACKUP_FILE_TOKENS = [
  { token: '{date}', meaning: 'date, like 2026-10-12' },
  { token: '{time}', meaning: 'time, like 14-05-09' },
  { token: '{groups}', meaning: 'number of groups' },
  { token: '{tabs}', meaning: 'number of tabs' },
] as const;

export const BACKUP_FILE_LIMITS = {
  /** folders below Downloads */
  folderDepth: 5,
  /** one folder name, or the file name without `.json` */
  segmentLength: 100,
  /** the whole relative path including `.json` */
  pathLength: 240,
  patternLength: 100,
} as const;

export const BACKUP_FILE_COPY = {
  toggle: 'Also save a file to this computer',
  description:
    'Each backup is also written as a JSON file you can import again. The file is not encrypted: anyone who can open your Downloads folder can read the tabs in it.',
  location:
    "Files go inside your browser's Downloads folder. To use another location, change the browser's download location.",
  retention: 'TabMerger never deletes these files. Remove old ones yourself when you no longer need them.',
  folderLabel: 'Folder inside Downloads',
  patternLabel: 'File name',
  permissionDenied: 'TabMerger needs permission to save files. Allow it in the browser prompt to turn this on.',
  permissionRevoked: 'Turned off: TabMerger no longer has permission to save files. Turn it on to allow it again.',
} as const;

export type BackupPathResult = { ok: true; value: string } | { ok: false; error: string };

const fail = (error: string): BackupPathResult => ({ ok: false, error });

/** Characters Windows refuses in file names (macOS and Linux accept most, but the same file must work everywhere). */
const ILLEGAL_CHARS = /[<>:"|?*]/;
/** C0 controls, DEL and the C1 controls (U+0080 to U+009F). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
/**
 * Characters that are not shown, or that change the order text is shown in: soft hyphen, the
 * Arabic letter mark, zero-width spaces and joiners, the left-to-right / right-to-left marks,
 * embeddings, overrides and isolates, line and paragraph separators, the word joiner and the
 * invisible operators, and the byte order mark. In a file name they make one name look like
 * another (`backup\u202enosj.exe` is displayed as `backupexe.json`).
 */
const INVISIBLE_CHARS = /[\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;
const INVISIBLE_CHARS_MESSAGE = 'Names cannot contain invisible or text-direction characters.';
/**
 * Windows device names: `CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, and `COM` / `LPT`
 * followed by one digit, 0 to 9 or a superscript 1, 2 or 3 (Windows reads those as digits too).
 * Reserved with or without an extension, and with spaces before the dot (`con.txt`,
 * `LPT1.json`, `NUL .txt`).
 */
const RESERVED_NAME = /^(con|prn|aux|nul|conin\$|conout\$|(com|lpt)[0-9\u00b9\u00b2\u00b3]) *(\..*)?$/i;

/** Why one path segment (a folder name, or a file name) cannot be used; `null` when it is fine. */
export function backupSegmentProblem(segment: string): string | null {
  if (segment === '') return 'A name cannot be empty.';
  if (segment === '.' || segment === '..') return 'A folder cannot be "." or "..".';
  if (CONTROL_CHARS.test(segment)) return 'Names cannot contain control characters.';
  if (INVISIBLE_CHARS.test(segment)) return INVISIBLE_CHARS_MESSAGE;
  if (ILLEGAL_CHARS.test(segment)) return 'Names cannot contain any of < > : " | ? *';
  if (segment !== segment.trim()) return 'A name cannot start or end with a space.';
  if (segment.startsWith('.') || segment.endsWith('.')) return 'A name cannot start or end with a dot.';
  if (RESERVED_NAME.test(segment)) return `"${segment}" is a name Windows reserves and cannot be used.`;
  if (segment.length > BACKUP_FILE_LIMITS.segmentLength) return `A name can be at most ${BACKUP_FILE_LIMITS.segmentLength} characters.`;
  return null;
}

/**
 * Checks a folder typed by the user. Accepts a relative path below Downloads (`TabMerger`,
 * `Backups/TabMerger`); backslashes are read as `/` and one trailing `/` is ignored. An empty
 * value means "directly in Downloads". Rejected: anything absolute (leading `/`, a drive letter,
 * `~`), `.` and `..`, empty segments, illegal characters, reserved names, names starting or
 * ending with a dot or a space, more than {@link BACKUP_FILE_LIMITS}.folderDepth levels.
 * `value` is the normalised folder (segments joined with `/`, no leading or trailing slash).
 */
export function validateBackupFolder(input: unknown): BackupPathResult {
  if (typeof input !== 'string') return fail('Enter a folder name.');
  if (CONTROL_CHARS.test(input)) return fail('Names cannot contain control characters.');
  // on the raw text: `trim()` below would silently drop some of them (the byte order mark)
  if (INVISIBLE_CHARS.test(input)) return fail(INVISIBLE_CHARS_MESSAGE);
  const normalised = input.replace(/\\/g, '/');
  if (normalised.trim() === '') return { ok: true, value: '' };
  if (normalised.startsWith('/') || normalised.startsWith('~')) return fail('Use a folder inside Downloads, not a full path.');
  if (/^[A-Za-z]:/.test(normalised)) return fail('Use a folder inside Downloads, not a drive letter.');
  const segments = (normalised.endsWith('/') ? normalised.slice(0, -1) : normalised).split('/');
  if (segments.length > BACKUP_FILE_LIMITS.folderDepth) return fail(`Use at most ${BACKUP_FILE_LIMITS.folderDepth} folder levels.`);
  for (const segment of segments) {
    const problem = backupSegmentProblem(segment);
    if (problem) return fail(segment === '' ? 'Remove the empty folder name (two slashes in a row).' : problem);
  }
  return { ok: true, value: segments.join('/') };
}

const TOKEN_RE = /\{[^{}]*\}/g;
const KNOWN_TOKENS: readonly string[] = BACKUP_FILE_TOKENS.map((t) => t.token);

/**
 * Checks a file name pattern typed by the user (without `.json`, which is always added). It is a
 * single file name: no `/` or `\`. Only the placeholders in {@link BACKUP_FILE_TOKENS} are
 * allowed, braces must form a placeholder, and the name it produces must itself be a valid file
 * name. `value` is the pattern, trimmed.
 */
export function validateBackupFilePattern(input: unknown): BackupPathResult {
  if (typeof input !== 'string') return fail('Enter a file name.');
  if (CONTROL_CHARS.test(input)) return fail('Names cannot contain control characters.');
  // on the raw text: `trim()` below would silently drop some of them (the byte order mark)
  if (INVISIBLE_CHARS.test(input)) return fail(INVISIBLE_CHARS_MESSAGE);
  const pattern = input.trim();
  if (pattern === '') return fail('Enter a file name.');
  if (pattern.length > BACKUP_FILE_LIMITS.patternLength) return fail(`A file name can be at most ${BACKUP_FILE_LIMITS.patternLength} characters.`);
  if (/[\\/]/.test(pattern)) return fail('A file name cannot contain / or \\. Put folders in the folder field.');
  const unknown = (pattern.match(TOKEN_RE) ?? []).find((t) => !KNOWN_TOKENS.includes(t));
  if (unknown) return fail(`${unknown} is not a placeholder. Use ${KNOWN_TOKENS.join(', ')}.`);
  if (/[{}]/.test(pattern.replace(TOKEN_RE, ''))) return fail('Curly braces are only for placeholders such as {date}.');
  // The placeholders only ever become digits and dashes. Two renderings are checked, because a
  // count can complete a reserved name: `com{groups}` is "com0" for no groups and "com1" for one.
  // Only a ONE-digit count can do that (`COM` / `LPT` take exactly one digit, and the date and
  // time always contain dashes), and it is rejected whichever digit it is: both renderings below
  // are a single digit, and every single digit is reserved. `buildBackupFilePath` checks the
  // real name again at write time and falls back to the default.
  // Each is checked without the extension (a name ending in a dot or a space) and with it (its length).
  for (const sample of PATTERN_SAMPLES) {
    const rendered = renderPattern(pattern, sample);
    const problem = backupSegmentProblem(rendered) ?? backupSegmentProblem(`${rendered}${BACKUP_FILE_EXTENSION}`);
    if (problem) return fail(problem);
  }
  return { ok: true, value: pattern };
}

/** The renderings a pattern is validated with: empty counts, and one group holding one tab. */
const PATTERN_SAMPLES: readonly BackupFileContext[] = [
  { createdAt: 0, groups: 0, tabs: 0 },
  { createdAt: 0, groups: 1, tabs: 1 },
];

export interface BackupFileContext {
  /** epoch ms the backup was taken */
  createdAt: number;
  groups: number;
  tabs: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const count = (n: number) => String(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);

function renderPattern(pattern: string, ctx: BackupFileContext): string {
  const d = new Date(Number.isFinite(ctx.createdAt) ? ctx.createdAt : 0);
  const values: Record<string, string> = {
    '{date}': `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    // no ":" in a file name
    '{time}': `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
    '{groups}': count(ctx.groups),
    '{tabs}': count(ctx.tabs),
  };
  return pattern.replace(TOKEN_RE, (token) => (Object.hasOwn(values, token) ? values[token] : ''));
}

/** The folder to use for a stored value: itself (normalised) when valid, otherwise the default. */
export function normalizeBackupFolder(input: unknown): string {
  const result = validateBackupFolder(input);
  return result.ok ? result.value : DEFAULT_BACKUP_FILE_FOLDER;
}

/** The pattern to use for a stored value: itself (trimmed) when valid, otherwise the default. */
export function normalizeBackupFilePattern(input: unknown): string {
  const result = validateBackupFilePattern(input);
  return result.ok ? result.value : DEFAULT_BACKUP_FILE_PATTERN;
}

/**
 * The path, relative to the Downloads folder, a backup file is written to:
 * `TabMerger/TabMerger backup 2026-10-12 14-05-09.json`. `folder` and `pattern` are validated
 * here again whatever the caller did (an invalid one is replaced by its default), and the
 * finished path is checked as a whole; if it is somehow still unusable or too long, the default
 * folder and pattern are used. The result never starts with `/`, never contains `..` or `\`.
 */
export function buildBackupFilePath(folder: unknown, pattern: unknown, ctx: BackupFileContext): string {
  const build = (f: string, p: string) => {
    const name = `${renderPattern(p, ctx)}${BACKUP_FILE_EXTENSION}`;
    return f === '' ? name : `${f}/${name}`;
  };
  const path = build(normalizeBackupFolder(folder), normalizeBackupFilePattern(pattern));
  const usable = path.length <= BACKUP_FILE_LIMITS.pathLength && path.split('/').every((segment) => backupSegmentProblem(segment) === null);
  return usable ? path : build(DEFAULT_BACKUP_FILE_FOLDER, DEFAULT_BACKUP_FILE_PATTERN);
}

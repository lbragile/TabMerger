import { AI_MAX_GROUP_DESCRIPTION_LENGTH } from '@tabmerger/shared';

/** Longest group note the note editor accepts (the textarea in Windows/index.tsx). */
export const GROUP_NOTE_MAX_LENGTH = 500;

/**
 * Control characters (C0, DEL, C1) and the bidi embedding/override/isolate controls. A note is
 * plain text: none of these belong in it, and the bidi ones could reorder the text around them.
 */
const UNWANTED_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/**
 * An AI provider's group description as note text: a string, control and bidi-control characters
 * dropped, whitespace runs (newlines included: the reply is 1-3 sentences) collapsed to one space,
 * trimmed and capped at `AI_MAX_GROUP_DESCRIPTION_LENGTH`. `null` when nothing usable is left.
 * The reply comes from an AI provider through our server, so it is untrusted input.
 */
export function cleanGroupDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(UNWANTED_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, AI_MAX_GROUP_DESCRIPTION_LENGTH)
    .trim();
  return text || null;
}

/** "Add below": the existing note, a blank line, then the description. */
export function appendDescription(note: string, description: string): string {
  return `${note.trimEnd()}\n\n${description}`;
}

/** Whether "Add below" still fits the note editor's limit (else only Replace is offered). */
export function canAppendDescription(note: string, description: string): boolean {
  return appendDescription(note, description).length <= GROUP_NOTE_MAX_LENGTH;
}

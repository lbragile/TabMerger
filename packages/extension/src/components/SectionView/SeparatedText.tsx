import { Fragment } from 'react';

/** The visual separator in meta lines such as "Archived ◆ 1 Window ◆ 6 Tabs". */
const SEPARATOR = '◆';

/** The lighter separator of the session view's lines ("Saved Nov 10 · 5 groups · 20 tabs"). */
export const DOT_SEPARATOR = '·';

/**
 * A translated meta line with its separators ("◆" by default, or `separator`) hidden from screen
 * readers (otherwise read as "black diamond" or "middle dot") and drawn fainter than the words;
 * the words around them are read as they are.
 */
export function SeparatedText({ text, separator = SEPARATOR }: { text: string; separator?: string }) {
  const parts = text.split(separator);
  const dot = separator !== SEPARATOR;
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && !dot && <span aria-hidden="true">{separator}</span>}
          {/* a line that may wrap breaks at the spaces around a "·", never inside "20 tabs" */}
          {i > 0 && dot && <>{' '}<span aria-hidden="true" className="opacity-60">{separator}</span>{' '}</>}
          {dot ? <span className="whitespace-nowrap">{part.trim()}</span> : part}
        </Fragment>
      ))}
    </>
  );
}

import { Fragment } from 'react';

/** The visual separator in meta lines such as "Archived ◆ 1 Window ◆ 6 Tabs". */
const SEPARATOR = '◆';

/**
 * A translated meta line with its "◆" separators hidden from screen readers (otherwise read as
 * "black diamond"); the words around them are read as they are.
 */
export function SeparatedText({ text }: { text: string }) {
  const parts = text.split(SEPARATOR);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">{SEPARATOR}</span>}
          {part}
        </Fragment>
      ))}
    </>
  );
}

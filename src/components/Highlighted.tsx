import { useMemo } from "react";
import styled from "styled-components";

import { useSelector } from "~/hooks/useRedux";

const MarkedText = styled.mark`
  background-color: #ffd580;
`;

export default function Highlighted({ text = "" }: { text?: string }): JSX.Element {
  const { inputValue } = useSelector((state) => state.header);

  /**
   * The brackets around the re variable keeps it in the array when splitting and does not affect testing
   * @example 'react'.split(/(ac)/gi) => ['re', 'ac', 't']
   */
  const re = useMemo(() => {
    const SPECIAL_CHAR_RE = /([.?*+^$[\]\\(){}|-])/g;
    const escapedSearch = inputValue.replace(SPECIAL_CHAR_RE, "\\$1");

    return new RegExp(`(${escapedSearch})`, "i");
  }, [inputValue]);

  return (
    <span>
      {inputValue === ""
        ? text
        : text
            .split(re)
            .filter((part) => part !== "")
            .map((part, i) => (re.test(part) ? <MarkedText key={part + i}>{part}</MarkedText> : part))}
    </span>
  );
}

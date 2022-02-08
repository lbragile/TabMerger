import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import styled from "styled-components";

import Checkbox from "~/components/Checkbox";
import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import Note from "~/components/Note";
import { DEFAULT_FILTER } from "~/constants/urls";
import { useDebounce } from "~/hooks/useDebounce";
import useLocalStorage from "~/hooks/useLocalStorage";
import { Message } from "~/styles/Message";
import { Row } from "~/styles/Row";
import TextArea from "~/styles/Textarea";
import { wildcardGlobToRegExp } from "~/utils/helper";

const StyledInput = styled.input`
  all: unset;
  border-bottom: 1px solid ${({ theme }) => theme.colors.onBackground};
  padding: 4px;
  width: 40ch;
`;

export default function Filter(): JSX.Element {
  const [excludeProtocol, setExcludeProtocol] = useLocalStorage("excludeProtocol", true);
  const [filter, setFilter] = useLocalStorage("urlFilter", "");

  const [localExcludeProtocol, setLocalExcludeProtocol] = useState(true);
  const [localFilter, setLocalFilter] = useState("");

  const [testUrl, setTestUrl] = useState("");
  const [isCaught, setIsCaught] = useState(false);

  const debouncedTestUrl = useDebounce(testUrl, 1000);

  useEffect(() => setLocalFilter(filter), [filter]);
  useEffect(() => setLocalExcludeProtocol(excludeProtocol), [excludeProtocol]);

  // Filter testing (to see if a given URL input is "caught" by the filters)
  useEffect(() => {
    if (testUrl !== "") {
      const caughtByFilter =
        localFilter.split(/,\s+/).filter((pattern) => wildcardGlobToRegExp(pattern).test(testUrl)).length > 0;

      setIsCaught(caughtByFilter);
    }
  }, [localFilter, testUrl]);

  // Appends or removes the default filters from the filter list
  useEffect(() => {
    if (localExcludeProtocol) {
      setLocalFilter((prev) => DEFAULT_FILTER + prev);
    } else {
      setLocalFilter((prev) => prev.replace(DEFAULT_FILTER, ""));
    }
  }, [localExcludeProtocol]);

  return (
    <>
      <Checkbox
        id="excludeProtocol"
        text={
          <>
            Exclude URLs that do not start with <b>http</b> or <b>https</b>
          </>
        }
        checked={localExcludeProtocol}
        setChecked={() => setLocalExcludeProtocol(!localExcludeProtocol)}
      ></Checkbox>

      <TextArea
        $width="100%"
        $background="white"
        placeholder="Please enter comma separated URLs that you want TabMerger to ignore"
        value={localFilter}
        onChange={({ target: { value } }) => setLocalFilter(value)}
      />

      <div>
        <h3>Test A Website</h3>
        <Row>
          <StyledInput
            value={testUrl}
            onChange={({ target: { value } }) => setTestUrl(value)}
            placeholder="Check if a given URL will be filtered"
          />
          {debouncedTestUrl !== "" && (
            <Message $error={!isCaught} $recent={isCaught}>
              <FontAwesomeIcon icon={isCaught ? "check-circle" : "times-circle"} color={isCaught ? "green" : "red"} />
              <span>URL will {isCaught ? "" : "not"} be filtered</span>
            </Message>
          )}
        </Row>
      </div>

      <Note>
        <p>
          <Link href="https://en.wikipedia.org/wiki/Glob_(programming)" title="Wildcard Glob Patterns" /> can be used to
          group many URL patterns!
        </p>

        <p>
          <Link href="https://en.wikipedia.org/wiki/Query_string" title="Query parameters" /> in URLs are
          ignored/trimmed
        </p>
      </Note>

      <ModalFooter
        showSave
        saveText="Apply"
        closeText="Cancel"
        handleSave={() => {
          setExcludeProtocol(localExcludeProtocol);
          setFilter(localFilter);
        }}
      />
    </>
  );
}

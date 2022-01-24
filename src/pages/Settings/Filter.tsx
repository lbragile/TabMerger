import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import styled from "styled-components";

import Link from "~/components/Link";
import { ModalFooter } from "~/components/Modal";
import { useDebounce } from "~/hooks/useDebounce";
import useLocalStorage from "~/hooks/useLocalStorage";
import { Message } from "~/styles/Message";
import { Note } from "~/styles/Note";
import TextArea from "~/styles/Textarea";
import { wildcardGlobToRegExp } from "~/utils/helper";

const Row = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: start;
  align-items: center;
  gap: 8px;
`;

const CheckboxContainer = styled(Row)`
  padding: unset;
  gap: 8px;

  & label,
  & input {
    cursor: pointer;
  }
`;

const StyledInput = styled.input`
  all: unset;
  border-bottom: 1px solid black;
  padding: 4px;
  width: 40ch;
`;

export default function Filter(): JSX.Element {
  const [excludeProtocol, setExcludeProtocol] = useLocalStorage("excludeProtocol", true);
  const [filter, setFilter] = useLocalStorage("urlFilter", "");

  const [testUrl, setTestUrl] = useState("");
  const [isCaught, setIsCaught] = useState(false);
  const [localFilter, setLocalFilter] = useState("");

  const debouncedTestUrl = useDebounce(testUrl, 1000);

  useEffect(() => {
    if (testUrl !== "") {
      const caughtByFilter = localFilter
        .split(/,\s+/)
        .map((pattern) => wildcardGlobToRegExp(pattern).test(testUrl))
        .some((x) => x);

      setIsCaught(caughtByFilter);
    }
  }, [localFilter, testUrl]);

  useEffect(() => {
    setLocalFilter(filter);
  }, [filter]);

  return (
    <>
      <CheckboxContainer>
        <input
          type="checkbox"
          id="excludeProtocol"
          name="excludeProtocol"
          checked={excludeProtocol}
          onChange={() => setExcludeProtocol(!excludeProtocol)}
        />
        <label htmlFor="excludeProtocol">
          Exclude URLs that do not start with <b>http</b> or <b>https</b>
        </label>
      </CheckboxContainer>

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
            <>
              <FontAwesomeIcon icon={isCaught ? "check-circle" : "times-circle"} color={isCaught ? "green" : "red"} />
              <Message $error={!isCaught}>URL will {isCaught ? "" : "not"} be filtered</Message>
            </>
          )}
        </Row>
      </div>

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>
            <Link
              href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions"
              title="Regular Expressions"
            />{" "}
            and/or <Link href="https://en.wikipedia.org/wiki/Glob_(programming)" title="Wildcard Glob Patterns" /> can
            be used!
          </p>
        </div>
      </Note>

      <ModalFooter showSave saveText="Apply" closeText="Cancel" handleSave={() => setFilter(localFilter)} />
    </>
  );
}

import { useState, useEffect, useCallback } from "react";
import styled from "styled-components";

import Link from "./Link";

import { TABMERGER_CONTACT, TABMERGER_DEMO_SITE, TABMERGER_ISSUES } from "~/constants/urls";
import Button from "~/styles/Button";
import { Column } from "~/styles/Column";
import { Row } from "~/styles/Row";
import TextArea from "~/styles/Textarea";

const ErrorContainer = styled(Column)`
  width: 100%;
  height: 100%;
  background-color: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.onBackground};
  border: 2px dashed red;
  padding: 32px;
  align-items: center;
`;

const Logo = styled.img`
  cursor: pointer;
`;

interface IErrorFallback {
  resetErrorBoundary: () => void;
}

export default function ErrorFallback({ resetErrorBoundary }: IErrorFallback): JSX.Element {
  const [storage, setStorage] = useState("");

  useEffect(() => {
    chrome.storage.local.get(null, (result) => {
      setStorage(JSON.stringify(result, null, 4));
    });
  }, []);

  const exportJSON = useCallback(() => {
    const file = new File([storage], `TabMerger Export.json`, { type: "application/json" });
    const url = URL.createObjectURL(file);
    chrome.downloads.download({ conflictAction: "uniquify", saveAs: true, filename: file.name, url }, () => "");
  }, [storage]);

  return (
    <ErrorContainer role="alert">
      <a href={TABMERGER_DEMO_SITE} title={TABMERGER_DEMO_SITE} target="_blank" rel="noreferrer">
        <Logo src="./images/logo128.png" alt="TabMerger Logo" />
      </a>
      <h1>Oops... something went wrong</h1>

      <h3>
        This might be a known <Link href={TABMERGER_ISSUES} title="issue" />. Consider{" "}
        <Link href={TABMERGER_CONTACT} title="sending us" /> an email indicating what went wrong
      </h3>

      <br />
      <h4>Current TabMerger Configuration</h4>
      <div>
        <TextArea value={storage} readOnly />
      </div>

      <br />

      <Row>
        <Button $variant="secondary" onClick={exportJSON}>
          Export (JSON)
        </Button>

        <Button $variant="primary" onClick={resetErrorBoundary}>
          Go Back
        </Button>
      </Row>
    </ErrorContainer>
  );
}

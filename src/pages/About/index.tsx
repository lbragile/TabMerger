import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import styled, { useTheme } from "styled-components";

import Link from "../../components/Link";
import Selector from "../../components/Selector";

import Details from "./Details";
import License from "./License";

import { ModalFooter, ModalHeader } from "~/components/Modal";
import { TABMERGER_DEMO_SITE, TABMERGER_TOS_LINK } from "~/constants/urls";
import { Note } from "~/styles/Note";
import { Row } from "~/styles/Row";

const StyledRow = styled(Row)`
  gap: 32px;
`;

const AboutTitle = styled.div`
  text-align: center;

  & p {
    opacity: 0.5;
  }
`;

const Logo = styled.img`
  cursor: pointer;
`;

const { version } = chrome.runtime.getManifest();

export default function About(): JSX.Element {
  const theme = useTheme();

  const [activeTab, setActiveTab] = useState<"Details" | "Licenses">("Details");

  return (
    <>
      <ModalHeader title="About TabMerger" />

      <StyledRow>
        <a href={TABMERGER_DEMO_SITE} title={TABMERGER_DEMO_SITE} target="_blank" rel="noreferrer">
          <Logo src="./images/logo48.png" alt="TabMerger Logo" />
        </a>

        <AboutTitle>
          <Link href={TABMERGER_DEMO_SITE} title={`TabMerger v${version}`} color={theme.colors.onBackground} />

          <p>Copyright &copy; {new Date().getFullYear()} lbragile</p>
          <p>All rights reserved</p>
        </AboutTitle>
      </StyledRow>

      <Selector opts={["Details", "Licenses"]} activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === "Details" ? <Details /> : <License />}

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>By using this software you agree to TabMerger&apos;s</p>

          <Link href={TABMERGER_TOS_LINK} title="Terms and Conditions" />
        </div>
      </Note>

      <ModalFooter showSave={false} />
    </>
  );
}

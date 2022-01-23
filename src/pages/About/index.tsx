import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import styled from "styled-components";

import Link from "../../components/Link";
import Selector from "../../components/Selector";

import Details from "./Details";
import License from "./License";

import ModalFooter from "~/components/ModalFooter";
import ModalHeader from "~/components/ModalHeader";
import { TABMERGER_DEMO_SITE, TABMERGER_TOS_LINK } from "~/constants/urls";
import { Note } from "~/styles/Note";

const Row = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
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
  const [activeTab, setActiveTab] = useState<"Details" | "Licenses">("Details");

  return (
    <>
      <ModalHeader title="About TabMerger" />

      <Row>
        <a href={TABMERGER_DEMO_SITE} title={TABMERGER_DEMO_SITE} target="_blank" rel="noreferrer">
          <Logo src="./images/logo48.png" alt="TabMerger Logo" />
        </a>

        <AboutTitle>
          <Link href={TABMERGER_DEMO_SITE} title={`TabMerger v${version}`} color="black" />

          <p>Copyright &copy; {new Date().getFullYear()} lbragile</p>
          <p>All rights reserved</p>
        </AboutTitle>
      </Row>

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

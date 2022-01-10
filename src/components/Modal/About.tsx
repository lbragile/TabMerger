import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Fragment, useState } from "react";
import styled from "styled-components";

import Link from "./Link";
import Selector from "./Selector";

import { TABMERGER_DEMO_SITE, EXTENSION_PAGE_LINK, TABMERGER_TOS_LINK, LICENSE_INFO } from "~/constants/urls";
import { Note } from "~/styles/Note";

const DetailsGrid = styled.div`
  display: grid;
  grid-template-columns: max-content 60%;
  gap: 16px;
  justify-content: center;

  & h4 {
    opacity: 0.5;
    justify-self: end;
  }
`;

const LicenseGrid = styled(DetailsGrid)`
  grid-template-columns: auto 29ch auto;
`;

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

const { version, description } = chrome.runtime.getManifest();

interface ILicenseName {
  title: string;
  url: string;
}

interface ILicenseDetails {
  name: ILicenseName;
  authors: string;
  license: ILicenseName;
}

const LICENSE_DETAILS: ILicenseDetails[] = [
  {
    name: { title: "TabMerger", url: LICENSE_INFO.TabMerger.repo },
    authors: "Lior Bragilevsky",
    license: { title: "GPLv3", url: LICENSE_INFO.TabMerger.license }
  },
  {
    name: { title: "React Beautiful DnD", url: LICENSE_INFO.ReactBeautifulDnD.repo },
    authors: "Atlassian Pty Ltd",
    license: { title: "Apache 2.0", url: LICENSE_INFO.ReactBeautifulDnD.license }
  },
  {
    name: { title: "React", url: LICENSE_INFO.React.repo },
    authors: "Facebook Inc",
    license: { title: "MIT", url: LICENSE_INFO.React.license }
  },
  {
    name: { title: "Redux", url: LICENSE_INFO.Redux.repo },
    authors: "Dan Abramov",
    license: { title: "MIT", url: LICENSE_INFO.Redux.license }
  },
  {
    name: { title: "Styled Components", url: LICENSE_INFO.StyledComponents.repo },
    authors: "Glen Maddern & Maximilian Stoiber",
    license: { title: "MIT", url: LICENSE_INFO.StyledComponents.license }
  },
  {
    name: { title: "File Saver", url: LICENSE_INFO.FileSaver.repo },
    authors: "Eli Grey",
    license: { title: "MIT", url: LICENSE_INFO.FileSaver.license }
  },
  {
    name: { title: "Nano ID", url: LICENSE_INFO.NanoID.repo },
    authors: "Andrey Sitnik",
    license: { title: "MIT", url: LICENSE_INFO.NanoID.license }
  }
];

export default function About(): JSX.Element {
  const [activeTab, setActiveTab] = useState<"Details" | "Licenses">("Details");

  return (
    <>
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

      {activeTab === "Details" ? (
        <DetailsGrid>
          <h4>Description</h4>
          <p>{description}</p>

          <h4>Language</h4>
          <p>{navigator.language}</p>

          <h4>Extension ID</h4>
          <Link href={EXTENSION_PAGE_LINK} title={chrome.runtime.id} />

          <h4>Version</h4>
          <p>v{version}</p>

          <h4>Subscription</h4>
          <p>Free</p>
        </DetailsGrid>
      ) : (
        <LicenseGrid>
          {LICENSE_DETAILS.map(({ name, authors, license }) => (
            <Fragment key={name.title}>
              <Link href={name.url} title={name.title} />

              <p>{authors}</p>

              <Link href={license.url} title={license.title} />
            </Fragment>
          ))}
        </LicenseGrid>
      )}

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>By using this software you agree to TabMerger&apos;s</p>

          <Link href={TABMERGER_TOS_LINK} title="Terms and Conditions" />
        </div>
      </Note>
    </>
  );
}

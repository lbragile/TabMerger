import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Fragment, useState } from "react";
import styled from "styled-components";

import Selector from "./Selector";

import {
  TABMERGER_DEMO_SITE,
  EXTENSION_PAGE_LINK,
  TABMERGER_TOS_LINK,
  TABMERGER_REPO,
  TABMERGER_LICENSE,
  REACT_BEAUTIFUL_DND_REPO,
  REACT_BEAUTIFUL_DND_LICENSE,
  REACT_REPO,
  REACT_LICENSE,
  REDUX_REPO,
  REDUX_LICENSE,
  STYLED_COMPONENTS_REPO,
  STYLED_COMPONENTS_LICENSE,
  FILE_SAVER_REPO,
  FILE_SAVER_LICENSE,
  NANOID_REPO,
  NANOID_LICENSE
} from "~/constants/urls";
import { Note } from "~/styles/Note";
import { StyledLink } from "~/styles/StyledLink";
import { createActiveTab } from "~/utils/helper";

const DetailsGrid = styled.div`
  display: grid;
  grid-template-columns: max-content 60%;
  gap: 8px 16px;
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
const extensionId = chrome.runtime.id;

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
    name: { title: "TabMerger", url: TABMERGER_REPO },
    authors: "Lior Bragilevsky",
    license: { title: "GPLv3", url: TABMERGER_LICENSE }
  },
  {
    name: { title: "React Beautiful DnD", url: REACT_BEAUTIFUL_DND_REPO },
    authors: "Atlassian Pty Ltd",
    license: { title: "Apache 2.0", url: REACT_BEAUTIFUL_DND_LICENSE }
  },
  { name: { title: "React", url: REACT_REPO }, authors: "Facebook Inc", license: { title: "MIT", url: REACT_LICENSE } },
  { name: { title: "Redux", url: REDUX_REPO }, authors: "Dan Abramov", license: { title: "MIT", url: REDUX_LICENSE } },
  {
    name: { title: "Styled Components", url: STYLED_COMPONENTS_REPO },
    authors: "Glen Maddern & Maximilian Stoiber",
    license: { title: "MIT", url: STYLED_COMPONENTS_LICENSE }
  },
  {
    name: { title: "File Saver", url: FILE_SAVER_REPO },
    authors: "Eli Grey",
    license: { title: "MIT", url: FILE_SAVER_LICENSE }
  },
  {
    name: { title: "Nano ID", url: NANOID_REPO },
    authors: "Andrey Sitnik",
    license: { title: "MIT", url: NANOID_LICENSE }
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
          <StyledLink
            $color="black"
            $header
            title={TABMERGER_DEMO_SITE}
            role="link"
            tabIndex={0}
            onClick={() => createActiveTab(TABMERGER_DEMO_SITE)}
            onKeyPress={({ key }) => key === "Enter" && createActiveTab(TABMERGER_DEMO_SITE)}
          >
            TabMerger v{version}
          </StyledLink>

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
          <StyledLink
            tabIndex={0}
            role="link"
            title={EXTENSION_PAGE_LINK}
            onClick={() => createActiveTab(EXTENSION_PAGE_LINK)}
            onKeyPress={({ key }) => key === "Enter" && createActiveTab(EXTENSION_PAGE_LINK)}
          >
            {extensionId}
          </StyledLink>

          <h4>Version</h4>
          <p>v{version}</p>

          <h4>Subscription</h4>
          <p>Free</p>
        </DetailsGrid>
      ) : (
        <LicenseGrid>
          {LICENSE_DETAILS.map(({ name, authors, license }) => (
            <Fragment key={name.title}>
              <StyledLink
                $color="#0073e6"
                tabIndex={0}
                role="link"
                title={name.url}
                onClick={() => createActiveTab(name.url)}
                onKeyPress={({ key }) => key === "Enter" && createActiveTab(name.url)}
              >
                {name.title}
              </StyledLink>

              <p>{authors}</p>

              <StyledLink
                $color="#0073e6"
                tabIndex={0}
                role="link"
                title={license.url}
                onClick={() => createActiveTab(license.url)}
                onKeyPress={({ key }) => key === "Enter" && createActiveTab(license.url)}
              >
                {license.title}
              </StyledLink>
            </Fragment>
          ))}
        </LicenseGrid>
      )}

      <Note>
        <FontAwesomeIcon icon="exclamation-circle" color="#aaa" size="2x" />

        <div>
          <p>By using this software you agree to TabMerger&apos;s</p>

          <StyledLink
            title={TABMERGER_TOS_LINK}
            role="link"
            tabIndex={0}
            onClick={() => createActiveTab(TABMERGER_TOS_LINK)}
            onKeyPress={({ key }) => key === "Enter" && createActiveTab(TABMERGER_TOS_LINK)}
          >
            Terms and Conditions
          </StyledLink>
        </div>
      </Note>
    </>
  );
}

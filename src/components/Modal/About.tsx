import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Fragment, useState } from "react";
import styled, { css } from "styled-components";

import Selector from "./Selector";

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

const StyledLink = styled.span<{ $color?: string; $header?: boolean }>`
  color: ${({ $color }) => $color ?? "#0645ad"};
  cursor: pointer;
  ${({ $header }) =>
    $header &&
    css`
      font-size: 16px;
      font-weight: bold;
    `}

  &:hover {
    text-decoration: underline;
  }
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

const Note = styled.div`
  padding: 12px;
  background-color: #f0f0f0;
  text-align: center;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;

  & p {
    opacity: 0.75;
  }
`;

const { version, description } = chrome.runtime.getManifest();
const extensionId = chrome.runtime.id;

const TABMERGER_DEMO_SITE = "https://lbragile.github.io/TabMerger-Extension/";
const EXTENSION_PAGE_LINK = `chrome://extensions?id=${extensionId}`;
const TOS_LINK = "https://lbragile.github.io/TabMerger-Extension/terms";

const handleLinkClick = (url: string) => chrome.tabs.create({ url, active: true }, () => "");

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
    name: { title: "TabMerger", url: "https://github.com/lbragile/TabMerger" },
    authors: "Lior Bragilevsky",
    license: { title: "GPLv3", url: "https://github.com/lbragile/TabMerger/blob/master/LICENSE.md" }
  },
  {
    name: { title: "React Beautiful DnD", url: "https://github.com/atlassian/react-beautiful-dnd" },
    authors: "Atlassian Pty Ltd",
    license: { title: "Apache 2.0", url: "https://github.com/atlassian/react-beautiful-dnd/blob/master/LICENSE" }
  },
  {
    name: { title: "React", url: "https://github.com/facebook/react" },
    authors: "Facebook Inc",
    license: { title: "MIT", url: "https://github.com/facebook/react/blob/main/LICENSE" }
  },
  {
    name: { title: "Redux", url: "https://github.com/reduxjs/redux" },
    authors: "Dan Abramov",
    license: { title: "MIT", url: "https://github.com/reduxjs/redux/blob/master/LICENSE.md" }
  },
  {
    name: { title: "Styled Components", url: "https://github.com/styled-components/styled-components" },
    authors: "Glen Maddern & Maximilian Stoiber",
    license: { title: "MIT", url: "https://github.com/styled-components/styled-components/blob/main/LICENSE" }
  },
  {
    name: { title: "File Saver", url: "https://github.com/eligrey/FileSaver.js" },
    authors: "Eli Grey",
    license: { title: "MIT", url: "https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md" }
  },
  {
    name: { title: "Nano ID", url: "https://github.com/ai/nanoid" },
    authors: "Andrey Sitnik",
    license: { title: "MIT", url: "https://github.com/ai/nanoid/blob/main/LICENSE" }
  },
  {
    name: { title: "Mantine", url: "https://github.com/mantinedev/mantine" },
    authors: "Vitaly Rtishchev",
    license: { title: "MIT", url: "https://github.com/mantinedev/mantine/blob/master/LICENSE" }
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
            onClick={() => handleLinkClick(TABMERGER_DEMO_SITE)}
            onKeyPress={({ key }) => key === "Enter" && handleLinkClick(TABMERGER_DEMO_SITE)}
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
            onClick={() => handleLinkClick(EXTENSION_PAGE_LINK)}
            onKeyPress={({ key }) => key === "Enter" && handleLinkClick(EXTENSION_PAGE_LINK)}
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
                onClick={() => handleLinkClick(name.url)}
                onKeyPress={({ key }) => key === "Enter" && handleLinkClick(name.url)}
              >
                {name.title}
              </StyledLink>

              <p>{authors}</p>

              <StyledLink
                $color="#0073e6"
                tabIndex={0}
                role="link"
                title={license.url}
                onClick={() => handleLinkClick(license.url)}
                onKeyPress={({ key }) => key === "Enter" && handleLinkClick(license.url)}
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
            title={TOS_LINK}
            role="link"
            tabIndex={0}
            onClick={() => handleLinkClick(TOS_LINK)}
            onKeyPress={({ key }) => key === "Enter" && handleLinkClick(TOS_LINK)}
          >
            Terms and Conditions
          </StyledLink>
        </div>
      </Note>
    </>
  );
}

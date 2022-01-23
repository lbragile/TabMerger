import styled from "styled-components";

import Link from "../../components/Link";

import { EXTENSION_PAGE_LINK } from "~/constants/urls";

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

const { version, description } = chrome.runtime.getManifest();

export default function Details(): JSX.Element {
  return (
    <>
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
    </>
  );
}

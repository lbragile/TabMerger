import styled from "styled-components";

const Grid = styled.div`
  display: grid;
  grid-template-columns: max-content 60%;
  justify-items: flex-start;
  gap: 4px 16px;
`;

const IDLink = styled.span`
  color: #0645ad;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

export default function About(): JSX.Element {
  const { version, description } = chrome.runtime.getManifest();
  const extensionId = chrome.runtime.id;

  const handleExtensionIdClick = () =>
    chrome.tabs.create({ url: `chrome://extensions?id=${extensionId}`, active: true }, () => "");

  return (
    <div>
      <div>Logo</div>
      <div>Tabs</div>
      <Grid>
        <h3>Description</h3>
        <p>{description}</p>

        <h3>Language</h3>
        <p>{navigator.language}</p>

        <h3>Extension ID</h3>
        <IDLink
          tabIndex={0}
          role="link"
          onClick={handleExtensionIdClick}
          onKeyPress={({ key }) => key === "Enter" && handleExtensionIdClick()}
        >
          {extensionId}
        </IDLink>

        <h3>Version</h3>
        <p>v{version}</p>

        <h3>Subscription</h3>
        <p>Free</p>
      </Grid>
    </div>
  );
}

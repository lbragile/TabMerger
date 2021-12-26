import styled from "styled-components";

const Grid = styled.div`
  display: grid;
  grid-template-columns: max-content 60%;
  justify-items: flex-start;
  gap: 4px 16px;
`;

export default function About(): JSX.Element {
  const { version, description } = chrome.runtime.getManifest();

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
        <a
          href="https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc?hl=en"
          target="_blank"
          rel="noopener noreferrer"
        >
          inmiajapbpafmhjleiebcamfhkfnlgoc
        </a>

        <h3>Version</h3>
        <p>v{version}</p>

        <h3>Subscription</h3>
        <p>Free</p>
      </Grid>
    </div>
  );
}

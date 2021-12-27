import { createGlobalStyle, css } from "styled-components";

// eslint-disable-next-line capitalized-comments
/* stylelint-disable block-opening-brace-newline-after */
export const GlobalStyle = createGlobalStyle`${css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  * {
    margin: 0;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;

    &:not(input):focus-visible {
      outline: 1px solid #000;
      outline-offset: -1px;
    }
  }

  html,
  body {
    height: 100%;
  }

  body {
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  p,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    overflow-wrap: break-word;
  }

  input,
  button,
  textarea,
  select {
    font: inherit;
  }

  #root {
    isolation: isolate;
  }
`}
`;

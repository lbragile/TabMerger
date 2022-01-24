import { StrictMode } from "react";
import { render } from "react-dom";

import App from "./components/App";
import ThemeWrapper from "./components/ThemeWrapper";
import StoreProvider from "./store/configureStore";

render(
  <StrictMode>
    <StoreProvider>
      <ThemeWrapper>
        <App />
      </ThemeWrapper>
    </StoreProvider>
  </StrictMode>,
  document.getElementById("root")
);

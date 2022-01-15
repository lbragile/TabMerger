import { StrictMode } from "react";
import { render } from "react-dom";

import App from "./components/App";
import StoreProvider from "./store/configureStore";

render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
  document.getElementById("root")
);

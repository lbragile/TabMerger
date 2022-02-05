import { StrictMode } from "react";
import { render } from "react-dom";
import { Provider } from "react-redux";

import App from "./components/App";
import ThemeWrapper from "./components/ThemeWrapper";
import { store } from "./store/configureStore";

render(
  <StrictMode>
    <Provider store={store}>
      <ThemeWrapper>
        <App />
      </ThemeWrapper>
    </Provider>
  </StrictMode>,
  document.getElementById("root")
);

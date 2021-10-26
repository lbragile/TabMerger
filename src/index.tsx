import React from "react";
import ReactDOM from "react-dom";
import App from "./components/App";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import rootReducer from "./store/reducers";
import { composeWithDevTools } from "remote-redux-devtools";
import logger from "redux-logger";

const composeEnhancers = composeWithDevTools({
  name: "TabMerger",
  realtime: true,
  hostname: "localhost",
  port: 8080
});

export const store = createStore(rootReducer, composeEnhancers(applyMiddleware(logger)));

ReactDOM.render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
  document.getElementById("root")
);

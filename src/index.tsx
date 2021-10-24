import React from "react";
import ReactDOM from "react-dom";
import App from "./components/App";
import { Provider } from "react-redux";
import { applyMiddleware, compose, createStore } from "redux";
import rootReducer from "./store/reducers";
import logger from "redux-logger";

const composeWithDevTools =
  typeof window !== "undefined" && window["__REDUX_DEVTOOLS_EXTENSION_COMPOSE__" as keyof Window]
    ? window["__REDUX_DEVTOOLS_EXTENSION_COMPOSE__" as keyof Window]
    : function (...args: (() => void)[]) {
        if (args.length === 0) return undefined;
        return typeof args[0] === "object" ? compose : compose(...args);
      };

export const store = createStore(rootReducer, composeWithDevTools(applyMiddleware(logger)));

ReactDOM.render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
  document.getElementById("root")
);

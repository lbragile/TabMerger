import { applyMiddleware, createStore } from "redux";
import { createLogger } from "redux-logger";
import { composeWithDevTools } from "remote-redux-devtools";

import rootReducer from "~/store/reducers";

const composeEnhancers = composeWithDevTools({
  name: "TabMerger",
  realtime: true,
  hostname: "localhost",
  port: 8080
});

const logger = createLogger({
  collapsed: true,
  duration: true,
  predicate: () => process.env.NODE_ENV === "development"
});

export const store = createStore(rootReducer, composeEnhancers(applyMiddleware(logger)));

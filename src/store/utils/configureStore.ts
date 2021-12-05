import { applyMiddleware, createStore } from "redux";
import { composeWithDevTools } from "remote-redux-devtools";
import { createLogger } from "redux-logger";
import rootReducer from "../reducers";

const logger = createLogger({
  collapsed: true,
  duration: true,
  predicate: () => process.env.NODE_ENV === "development"
});

const composeEnhancers = composeWithDevTools({
  name: "TabMerger",
  realtime: true,
  hostname: "localhost",
  port: 8080
});

export const store = createStore(rootReducer, composeEnhancers(applyMiddleware(logger)));

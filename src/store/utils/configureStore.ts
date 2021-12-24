import { applyMiddleware, createStore } from "redux";
import { createLogger } from "redux-logger";
import rootReducer from "../reducers";

const logger = createLogger({
  collapsed: true,
  duration: true,
  predicate: () => process.env.NODE_ENV === "development"
});

export const store = createStore(rootReducer, applyMiddleware(logger));

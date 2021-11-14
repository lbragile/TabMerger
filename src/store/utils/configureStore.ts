import { applyMiddleware, createStore } from "redux";
import { composeWithDevTools } from "remote-redux-devtools";
import logger from "redux-logger";
import rootReducer from "../reducers";

const composeEnhancers = composeWithDevTools({
  name: "TabMerger",
  realtime: true,
  hostname: "localhost",
  port: 8080
});

export const store = createStore(rootReducer, composeEnhancers(applyMiddleware(logger)));

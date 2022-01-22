import { useCallback } from "react";

import { TRootReducer } from "~/typings/redux";

function getTimestamp() {
  const d = new Date();

  // Need to zero pad each value
  const [h, m, s, ms] = [d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()].map((val) =>
    ("0" + val).slice(-2)
  );

  return `${h}:${m}:${s}.${ms}`;
}

const getStyle = (color: string) => `color: ${color}; font-weight: 600;`;

export default function useReducerLogger(reducer: TRootReducer): TRootReducer {
  return useCallback(
    (prevState, action) => {
      const nextState = reducer(prevState, action);

      console.groupCollapsed(
        `%c action %c${action.type} %c@ ${getTimestamp()}`,
        getStyle("#9e9e9e"),
        getStyle("initial"),
        getStyle("#9e9e9e")
      );

      console.info("%c prev state", getStyle("#9e9e9e"), prevState);
      console.info("%c action", getStyle("#00a7f7"), action);
      console.info("%c next state", getStyle("#47b04b"), nextState);

      console.groupEnd();

      return nextState;
    },
    [reducer]
  );
}

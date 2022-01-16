import { createContext, Dispatch, useMemo, useReducer } from "react";

import useReducerLogger from "~/hooks/useReducerLogger";
import { rootReducer, combinedState } from "~/store/reducers";
import { IAction, TRootReducer, TRootState } from "~/typings/reducers";

export const ReduxStore = createContext<{ state: TRootState; dispatch: Dispatch<IAction> }>({
  dispatch: () => "",
  state: combinedState
});

const StoreProvider = ({ children }: { children: JSX.Element }) => {
  const loggedReducer = useReducerLogger(rootReducer);

  const [state, dispatch] = useReducer<TRootReducer>(
    process.env.NODE_ENV === "development" ? loggedReducer : rootReducer,
    combinedState
  );

  const store = useMemo(() => ({ state, dispatch }), [state]);

  return <ReduxStore.Provider value={store}>{children}</ReduxStore.Provider>;
};

export default StoreProvider;

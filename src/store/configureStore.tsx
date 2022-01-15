import { createContext, Dispatch, Reducer, useMemo, useReducer } from "react";

import { rootReducer, combinedState } from "~/store/reducers";
import { IAction, TRootState } from "~/typings/reducers";

export const ReduxStore = createContext<{ state: TRootState; dispatch: Dispatch<IAction> }>({
  dispatch: () => "",
  state: combinedState
});

const StoreProvider = ({ children }: { children: JSX.Element }) => {
  const [state, dispatch] = useReducer<Reducer<TRootState, IAction>>(rootReducer, combinedState);

  const store = useMemo(() => ({ state, dispatch }), [state]);

  return <ReduxStore.Provider value={store}>{children}</ReduxStore.Provider>;
};

export default StoreProvider;

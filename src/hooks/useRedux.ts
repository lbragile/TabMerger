import { useContext } from "react";

import { ReduxStore } from "~/store/configureStore";
import { TRootState } from "~/typings/reducers";

type TypedUseSelectorHook = <U>(cb: (state: TRootState) => U) => U;

export const useSelector: TypedUseSelectorHook = (cb) => {
  const { state } = useContext(ReduxStore);

  return cb(state);
};

export const useDispatch = () => {
  const { dispatch } = useContext(ReduxStore);

  return dispatch;
};

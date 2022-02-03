import { useContext } from "react";

import type { TRootActions, TRootState } from "~/typings/redux";

import { addAction } from "~/store/actions/history";
import { ReduxStore } from "~/store/configureStore";

type TypedUseSelectorHook = <U>(cb: (state: TRootState) => U) => U;

export const useSelector: TypedUseSelectorHook = (cb) => {
  const { state } = useContext(ReduxStore);

  return cb(state);
};

export const useDispatch = (withHistory = false) => {
  const { dispatch } = useContext(ReduxStore);

  return withHistory
    ? (arg: TRootActions) => {
        dispatch(arg);
        dispatch(addAction(arg));
      }
    : dispatch;
};

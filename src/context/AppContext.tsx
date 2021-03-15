import React, { createContext } from "react";
import { setStateType } from "../typings/common";

interface AppContextInterface {
  user: { paid: string | boolean; tier: string };
  setTabTotal: setStateType<number>;
  setGroups: setStateType<string>;
  setDialog?: setStateType<{ show: boolean }>;
}

export const AppContext = createContext<AppContextInterface>(undefined);

export function AppProvider({ value, children }: { value: AppContextInterface; children: JSX.Element }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

import React, { createContext } from "react";

interface AppContextInterface {
  user: { paid: string | boolean; tier: string };
  setTabTotal: React.Dispatch<React.SetStateAction<number>>;
  setGroups: React.Dispatch<React.SetStateAction<string>>;
}

export const AppContext = createContext<AppContextInterface>(undefined);

export function AppProvider({
  value,
  children,
}: {
  value: AppContextInterface;
  children: React.ChildContextProvider<AppContextInterface>;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

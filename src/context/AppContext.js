import React, { createContext } from "react";

export const AppContext = createContext();

export function AppProvider({ value, children }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

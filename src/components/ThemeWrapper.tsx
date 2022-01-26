import { useMemo } from "react";
import { ThemeProvider } from "styled-components";

import useDarkMode from "~/hooks/useDarkMode";
import { ThemeOptions } from "~/styles/ThemeOptions";

export default function ThemeWrapper({ children }: { children: JSX.Element }) {
  const [darkMode] = useDarkMode();

  const APP_THEME = useMemo(() => (darkMode ? ThemeOptions.dark : ThemeOptions.light), [darkMode]);

  return <ThemeProvider theme={APP_THEME}>{children}</ThemeProvider>;
}

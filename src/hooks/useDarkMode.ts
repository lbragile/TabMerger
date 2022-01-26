import { useEffect } from "react";

import useLocalStorage from "./useLocalStorage";

/**
 * Wrapper for dark mode determination based on chrome.storage.local value
 * @see https://usehooks-ts.com/react-hook/use-dark-mode
 */
export default function useDarkMode(): [boolean, (arg: boolean) => void] {
  const isDarkOS = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [isDarkMode, setIsDarkMode] = useLocalStorage("darkMode", isDarkOS ?? false);

  // Update `darkMode` if OS preference changes
  useEffect(() => {
    setIsDarkMode(isDarkOS);
  }, [isDarkOS, setIsDarkMode]);

  return [isDarkMode, setIsDarkMode];
}

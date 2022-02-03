import type { ThemeOptions } from "~/styles/ThemeOptions";

type TMainTheme = typeof ThemeOptions["light"];

declare module "styled-components" {
  export interface DefaultTheme extends TMainTheme {
    [key: string]: unknown;
  }
}

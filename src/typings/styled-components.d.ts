import Theme from "~/styles/Theme";

type TMainTheme = typeof Theme;

declare module "styled-components" {
  export interface DefaultTheme extends TMainTheme {
    temp?: string;
  }
}

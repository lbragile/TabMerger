export type TModalType = "import" | "export" | "sync" | "settings" | "about";

export type TImportType = "json" | "text" | "markdown" | "csv";

export type TExportType = TImportType | "html";

export type TSyncType = "Upload" | "Download";

export interface ISyncDataItem {
  name: string;
  color: string;
  windows: {
    incognito: boolean;
    starred: boolean | undefined;
    name: string | undefined;
    tabs: {
      title: string | undefined;
      url: string | undefined;
    }[];
  }[];
}

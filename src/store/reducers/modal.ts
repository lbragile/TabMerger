import { IGroupItemState } from "./groups";

import { TRootActions } from "~/typings/redux";

export const MODAL_ACTIONS = {
  SET_MODAL_TYPE: "SET_MODAL_TYPE",
  UPDATE_EXPORT_FILE: "UPDATE_EXPORT_FILE",
  UPDATE_IMPORT_FORMATTED_GROUPS: "UPDATE_IMPORT_FORMATTED_GROUPS",
  UPDATE_IMPORT_TYPE: "UPDATE_IMPORT_TYPE",
  UPDATE_SYNC_TYPE: "UPDATE_SYNC_TYPE",
  UPDATE_SYNC_CURRENT_DATA: "UPDATE_SYNC_CURRENT_DATA",
  UPDATE_SYNC_POSSIBLE_DATA: "UPDATE_SYNC_POSSIBLE_DATA",
  SET_VISIBILITY: "SET_VISIBILITY"
} as const;

export type TModalType = "import" | "export" | "sync" | "settings" | "about";

export type TImportType = "json" | "plain" | "markdown" | "csv";

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

export interface IModalState {
  visible: boolean;
  type: TModalType;
  export: {
    file: File | null;
  };
  import: {
    type: TImportType;
    formatted: IGroupItemState[];
  };
  sync: {
    type: TSyncType;
    currentData: ISyncDataItem[];
    possibleData: ISyncDataItem[];
  };
}

export const initModalState: IModalState = {
  visible: false,
  type: "about",
  export: {
    file: null
  },
  import: {
    type: "json",
    formatted: []
  },
  sync: {
    type: "Upload",
    currentData: [],
    possibleData: []
  }
};

const modalReducer = (state = initModalState, action: TRootActions): IModalState => {
  switch (action.type) {
    case MODAL_ACTIONS.SET_VISIBILITY:
      return {
        ...state,
        visible: action.payload
      };

    case MODAL_ACTIONS.SET_MODAL_TYPE:
      return {
        ...state,
        type: action.payload
      };

    case MODAL_ACTIONS.UPDATE_EXPORT_FILE:
      return {
        ...state,
        export: {
          ...state.export,
          file: action.payload
        }
      };

    case MODAL_ACTIONS.UPDATE_IMPORT_FORMATTED_GROUPS:
      return {
        ...state,
        import: {
          ...state.import,
          formatted: action.payload
        }
      };

    case MODAL_ACTIONS.UPDATE_IMPORT_TYPE:
      return {
        ...state,
        import: {
          ...state.import,
          type: action.payload
        }
      };

    case MODAL_ACTIONS.UPDATE_SYNC_TYPE:
      return {
        ...state,
        sync: {
          ...state.sync,
          type: action.payload
        }
      };

    case MODAL_ACTIONS.UPDATE_SYNC_CURRENT_DATA:
      return {
        ...state,
        sync: {
          ...state.sync,
          currentData: action.payload
        }
      };

    case MODAL_ACTIONS.UPDATE_SYNC_POSSIBLE_DATA:
      return {
        ...state,
        sync: {
          ...state.sync,
          possibleData: action.payload
        }
      };

    default:
      return state;
  }
};

export default modalReducer;

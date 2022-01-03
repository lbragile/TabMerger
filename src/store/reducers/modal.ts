import { IGroupItemState } from "./groups";

import { IAction } from "~/typings/reducers";

export const MODAL_ACTIONS = {
  SET_MODAL_INFO: "SET_MODAL_INFO",
  UPDATE_EXPORT_FILE: "UPDATE_EXPORT_FILE",
  UPDATE_IMPORT_FORMATTED_GROUPS: "UPDATE_IMPORT_FORMATTED_GROUPS",
  UPDATE_IMPORT_TYPE: "UPDATE_IMPORT_TYPE"
};

type TModalType = "about" | "settings" | "import" | "export";

export type TImportType = "json" | "csv" | "markdown" | "plain";

export interface IModalState {
  info: {
    title: string;
    type: TModalType;
    closeText: string;
    saveText?: string;
  };
  export: {
    file: File | null;
  };
  import: {
    type: TImportType;
    formatted: IGroupItemState[];
  };
}

const initState: IModalState = {
  info: {
    title: "About TabMerger",
    type: "about",
    closeText: "Close"
  },
  export: {
    file: null
  },
  import: {
    type: "json",
    formatted: []
  }
};

const modalReducer = (state = initState, action: IAction): IModalState => {
  const { type, payload } = action;

  switch (type) {
    case MODAL_ACTIONS.SET_MODAL_INFO:
      return {
        ...state,
        info: payload as IModalState["info"]
      };

    case MODAL_ACTIONS.UPDATE_EXPORT_FILE:
      return {
        ...state,
        export: {
          ...state.export,
          file: payload as File
        }
      };

    case MODAL_ACTIONS.UPDATE_IMPORT_FORMATTED_GROUPS:
      return {
        ...state,
        import: {
          ...state.import,
          formatted: payload as IGroupItemState[]
        }
      };

    case MODAL_ACTIONS.UPDATE_IMPORT_TYPE:
      return {
        ...state,
        import: {
          ...state.import,
          type: payload as TImportType
        }
      };

    default:
      return state;
  }
};

export default modalReducer;

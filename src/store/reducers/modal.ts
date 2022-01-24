import { TRootActions } from "~/typings/redux";
import { TModalType } from "~/typings/settings";

export const MODAL_ACTIONS = {
  SET_MODAL_TYPE: "SET_MODAL_TYPE",
  SET_VISIBILITY: "SET_VISIBILITY"
} as const;

export interface IModalState {
  visible: boolean;
  type: TModalType;
}

export const initModalState: IModalState = {
  visible: false,
  type: "about"
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

    default:
      return state;
  }
};

export default modalReducer;

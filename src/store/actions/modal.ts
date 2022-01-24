import { MODAL_ACTIONS } from "~/store/reducers/modal";
import { TModalType } from "~/typings/settings";

export const setModalType = (payload: TModalType) => ({ type: MODAL_ACTIONS.SET_MODAL_TYPE, payload });

export const setVisibility = (payload: boolean) => ({ type: MODAL_ACTIONS.SET_VISIBILITY, payload });

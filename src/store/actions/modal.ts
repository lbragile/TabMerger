import { IGroupItemState } from "~/store/reducers/groups";
import { MODAL_ACTIONS, TImportType, ISyncDataItem, TSyncType, TModalType } from "~/store/reducers/modal";

export const setModalType = (payload: TModalType) => ({ type: MODAL_ACTIONS.SET_MODAL_TYPE, payload });

export const updateExportFile = (payload: File | null) => ({ type: MODAL_ACTIONS.UPDATE_EXPORT_FILE, payload });

export const updateImportFormattedGroups = (payload: IGroupItemState[]) => ({
  type: MODAL_ACTIONS.UPDATE_IMPORT_FORMATTED_GROUPS,
  payload
});

export const updateImportType = (payload: TImportType) => ({ type: MODAL_ACTIONS.UPDATE_IMPORT_TYPE, payload });

export const updateSyncType = (payload: TSyncType) => ({ type: MODAL_ACTIONS.UPDATE_SYNC_TYPE, payload });

export const updateSyncCurrentData = (payload: ISyncDataItem[]) => ({
  type: MODAL_ACTIONS.UPDATE_SYNC_CURRENT_DATA,
  payload
});

export const updateSyncPossibleData = (payload: ISyncDataItem[]) => ({
  type: MODAL_ACTIONS.UPDATE_SYNC_POSSIBLE_DATA,
  payload
});

export const setVisibility = (payload: boolean) => ({ type: MODAL_ACTIONS.SET_VISIBILITY, payload });

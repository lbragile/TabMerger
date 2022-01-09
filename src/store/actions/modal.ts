import { IGroupItemState } from "~/store/reducers/groups";
import { MODAL_ACTIONS, IModalState, TImportType, ISyncDataItem } from "~/store/reducers/modal";

const setModalInfo = (payload: IModalState["info"]) => ({ type: MODAL_ACTIONS.SET_MODAL_INFO, payload });

const updateExportFile = (payload: File | null) => ({ type: MODAL_ACTIONS.UPDATE_EXPORT_FILE, payload });

const updateImportFormattedGroups = (payload: IGroupItemState[]) => ({
  type: MODAL_ACTIONS.UPDATE_IMPORT_FORMATTED_GROUPS,
  payload
});

const updateImportType = (payload: TImportType) => ({ type: MODAL_ACTIONS.UPDATE_IMPORT_TYPE, payload });

const updateSyncLast = (payload: string) => ({ type: MODAL_ACTIONS.UPDATE_SYNC_TIMESTAMP, payload });

const updateSyncCurrentData = (payload: ISyncDataItem[]) => ({
  type: MODAL_ACTIONS.UPDATE_SYNC_CURRENT_DATA,
  payload
});

const updateSyncPossibleData = (payload: ISyncDataItem[]) => ({
  type: MODAL_ACTIONS.UPDATE_SYNC_POSSIBLE_DATA,
  payload
});

export default {
  setModalInfo,
  updateExportFile,
  updateImportFormattedGroups,
  updateImportType,
  updateSyncLast,
  updateSyncCurrentData,
  updateSyncPossibleData
};

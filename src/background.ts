import { BG_ACTIONS } from "./constants/backgroundActions";
import { IGroupsState } from "./store/reducers/groups";
import { TSentResponse } from "./typings/background";
import { executeResponse } from "./utils/background";

const getAllWindows = async () => {
  return await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
};

const getGroups = async () => {
  const key = "groups";
  const obj = await chrome.storage.local.get(key);
  return obj[key];
};

const handleMessage = (req: { type: string }, sender: chrome.runtime.MessageSender, res: TSentResponse<unknown>) => {
  switch (req.type) {
    case BG_ACTIONS.GET_ALL_WINDOWS:
      executeResponse<chrome.windows.Window[]>(res, getAllWindows);
      break;

    case BG_ACTIONS.GET_LOCAL_STORAGE:
      executeResponse<IGroupsState["available"]>(res, getGroups);
      break;

    default:
      break;
  }

  return true; /** @see https://developer.chrome.com/docs/extensions/mv3/messaging/#simple near the end */
};

chrome.runtime.onMessage.addListener(handleMessage);

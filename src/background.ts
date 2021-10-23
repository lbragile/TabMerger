import { ACTIONS } from "./constants/backgroundActions";
import { TSentResponse } from "./typings/background";
import { executeResponse } from "./utils/background";

const getAllWindows = async () => {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  return windows;
};

const handleMessage = (req: { type: string }, sender: chrome.runtime.MessageSender, res: TSentResponse<unknown>) => {
  switch (req.type) {
    case ACTIONS.GET_ALL_WINDOWS:
      executeResponse<chrome.windows.Window[]>(res, getAllWindows);
      break;

    default:
      break;
  }

  return true; /** @see https://developer.chrome.com/docs/extensions/mv3/messaging/#simple near the end */
};

chrome.runtime.onMessage.addListener(handleMessage);

import { nanoid } from "nanoid";
import { WINDOW_QUERY_OPTIONS } from "../constants/chrome";
import { IGroupItemState } from "../store/reducers/groups";
import { TSentResponse } from "../typings/background";
import { sortWindowsByFocus } from "./helper";

/**
 * Immediately Invoked Function Expression that executes the `sendResponse` function to response to the web page
 * @see https://stackoverflow.com/a/53024910/4298115
 */
export function executeResponse<T>(res: TSentResponse<T>, cb: () => Promise<T>): void {
  (async () => {
    res({ data: await cb() });
  })();
}

/**
 * Sets the "Awaiting Storage" group with corresponding data.
 * Additionally, sets the active group information
 */
export function setDefaultData(): void {
  // Get all the user's current open windows into the Awaiting Storage group
  chrome.windows.getAll(WINDOW_QUERY_OPTIONS, (windows) => {
    const activeId = nanoid(10);
    const active = { id: activeId, index: 0 };
    const { sortedWindows } = sortWindowsByFocus(windows);

    const available: IGroupItemState[] = [
      {
        name: "Awaiting Storage",
        id: activeId,
        windows: sortedWindows,
        color: "rgba(128, 128, 128, 1)",
        updatedAt: Date.now(),
        permanent: true
      }
    ];

    chrome.storage.local.set({ active, available }, () => "");
  });
}

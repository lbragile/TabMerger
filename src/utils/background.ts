import { nanoid } from "nanoid";

import { sortWindowsByFocus } from "./helper";

import { WINDOW_QUERY_OPTIONS } from "~/constants/chrome";
import { IGroupItemState } from "~/store/reducers/groups";
import { TSentResponse } from "~/typings/background";

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
 * Sets the "Now Open" group with corresponding data.
 * Additionally, sets the active group information
 */
export function setDefaultData(): void {
  // Get all the user's current open windows into the Now Open group
  chrome.windows.getAll(WINDOW_QUERY_OPTIONS, (windows) => {
    const activeId = nanoid(10);
    const active = { id: activeId, index: 0 };
    const { sortedWindows } = sortWindowsByFocus(windows);

    const available: IGroupItemState[] = [
      {
        name: "Now Open",
        id: activeId,
        windows: sortedWindows,
        color: "rgb(128 128 128)",
        updatedAt: Date.now(),
        permanent: true
      }
    ];

    chrome.storage.local.set({ active, available }, () => "");
  });
}

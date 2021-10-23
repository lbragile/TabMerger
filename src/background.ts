type TSentResponse = (response?: { data: unknown }) => void;

const getCurrentTab = async () => {
  const queryOptions = { active: true, currentWindow: true };
  const [tab] = await chrome.tabs.query(queryOptions);
  return tab;
};

/**
 * Immediately Invoked Function Expression that executes the `sendResponse` function to response to the web page
 * @see https://stackoverflow.com/a/53024910/4298115
 */
function executeResponse(res: TSentResponse, cb: () => Promise<unknown>): void {
  (async () => {
    res({ data: await cb() });
  })();
}

const handleMessage = (req: { type: string }, sender: chrome.runtime.MessageSender, res: TSentResponse) => {
  if (req.type == "hello background") {
    executeResponse(res, getCurrentTab);
  }

  /**
   * @see https://developer.chrome.com/docs/extensions/mv3/messaging/#simple near the end
   */
  return true;
};

// popup
chrome.runtime.onMessage.addListener(handleMessage);

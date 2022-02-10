import { useEffect } from "react";

import { useDispatch, useSelector } from "./useRedux";

import { updateInfo } from "~/store/actions/groups";

/**
 * Update each group's information if it doesn't match the current ...
 * ... whenever the list of groups updates
 */
export default function useUpdateInfo() {
  const dispatch = useDispatch();
  const { available } = useSelector((state) => state.groups.present);

  useEffect(() => {
    available.forEach((group, i) => {
      const { windows: allWindows, info } = group;
      const countArr = allWindows.map((currentWindow) => currentWindow.tabs?.length ?? 0);
      const numTabs = countArr.reduce((total, val) => total + val, 0);
      const numWindows = allWindows.length;
      const newInfo = `${numTabs}T | ${numWindows}W`;
      if (info !== newInfo) {
        dispatch(updateInfo({ index: i, info: newInfo }));
      }
    });

    // Badge Info Computation
    chrome.storage.local.get(["showBadgeInfo"], ({ showBadgeInfo }) => {
      let count = 0;

      if (showBadgeInfo) {
        available.slice(1).forEach(({ windows }) => windows.forEach(({ tabs }) => (count += tabs?.length ?? 0)));
      }

      const color = showBadgeInfo ? "#000F" : "#0000";
      const text = showBadgeInfo ? Intl.NumberFormat("en", { notation: "compact" }).format(count) : "";
      chrome.action.setBadgeBackgroundColor({ color }, () => "");
      chrome.action.setBadgeText({ text }, () => "");
    });
  }, [dispatch, available]);
}

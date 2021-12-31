import { useEffect } from "react";

import { useDispatch, useSelector } from "./useRedux";

import GROUPS_CREATORS from "~/store/actions/groups";


/**
 * Update each group's information if it doesn't match the current ...
 * ... whenever the list of groups updates
 */
export default function useUpdateInfo() {
  const dispatch = useDispatch();
  const { available } = useSelector((state) => state.groups);

  useEffect(() => {
    available.forEach((group, i) => {
      const { windows: allWindows, info } = group;
      const countArr = allWindows.map((currentWindow) => currentWindow.tabs?.length ?? 0);
      const numTabs = countArr.reduce((total, val) => total + val, 0);
      const numWindows = allWindows.length;
      const newInfo = `${numTabs}T | ${numWindows}W`;
      if (info !== newInfo) {
        dispatch(GROUPS_CREATORS.updateInfo({ index: i, info: newInfo }));
      }
    });
  }, [dispatch, available]);
}

/*
TabMerger as the name implies merges your tabs into one location to save
memory usage and increase your productivity.

Copyright (C) 2021  Lior Bragilevsky

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

If you have any questions, comments, or concerns you can contact the
TabMerger team at <https://lbragile.github.io/TabMerger-Extension/contact/>
*/

/**
 * @module Types/Common
 */

import { TabState } from "./Tab";

declare global {
  namespace NodeJS {
    interface Global {
      InstallTrigger: string;
      resolve: () => void;
      SYNC_LIMIT: readonly number;
      ITEM_LIMIT: readonly number;
      init_groups: { [key: string]: DefaultGroup };
      user: userType;
      CONSTANTS: any;
      TUTORIAL_GROUP: { [key: string]: DefaultGroup };
      exportedJSON: { settings: DefaultSettings; [key: string]: DefaultGroup };
      mockSet: <T>() => setStateType<T>;
      chromeLocalGetSpy: Function;
      chromeLocalSetSpy: Function;
      chromeSyncGetSpy: Function;
      chromeSyncSetSpy: Function;
      chromeBrowserActionSetBadgeTextSpy: Function;
      chromeBrowserActionSetBadgeBackgroundColorSpy: Function;
      chromeBrowserActionSetTitleSpy: Function;
      chromeLocalRemoveSpy: Function;
      toggleDarkModeSpy: Function;
      toggleSyncTimestampSpy: Function;
      chromeSyncRemoveSpy: Function;
      chromeTabsRemoveSpy: Function;
      chromeTabsQuerySpy: Function;
      chromeTabsCreateSpy: Function;
      chromeTabsMoveSpy: Function;
      chromeRuntimeSendMessageSpy: Function;
      chromeContextMenusCeateSpy: Function;
      chromeTabsOnUpdatedAdd: Function;
      chromeTabsOnUpdatedRemove: Function;
      chromeTabsUpdateSpy: Function;
    }
  }
}

/**
 * TYPES
 */
export type setStateType<T> = React.Dispatch<React.SetStateAction<T>>;
export type Toast = [JSX.Element, ToastId];
export type userType = { paid: string | boolean; tier: string };

/**
 * INTERFACES
 */
export interface TierOptions {
  [key: string]: {
    readonly NUM_TAB_LIMIT: number;
    readonly NUM_GROUP_LIMIT: number;
    readonly NUM_UNDO_STATES: number;
  };
}

export interface FontStyle {
  [key: string]: string;
}

export interface BadgeIconColors {
  [key: string]: string;
}

export interface DefaultGroup {
  color: string;
  created: string;
  hidden: boolean;
  locked: boolean;
  starred: boolean;
  tabs: TabState[];
  title: string;
  name?: string;
}

export interface DefaultSettings {
  badgeInfo: boolean;
  blacklist: string;
  color: string;
  dark: boolean;
  fileLimitBackup: number;
  font: string;
  merge: boolean;
  open: boolean;
  periodBackup: number;
  pin: boolean;
  randomizeColor: boolean;
  relativePathBackup: string;
  restore: boolean;
  saveAsVisibility: boolean;
  syncPeriodBackup: number;
  title: string;
  tooltipVisibility: boolean;
  weight: string;
}

export interface ToastId {
  toastId: string;
  [key: string]: string | boolean;
}

export interface DialogConstantReturn {
  element?: HTMLButtonElement;
  title?: string;
  msg?: JSX.Element;
  accept_btn_text?: string;
  reject_btn_text?: string;
  show: boolean;
}

/**
 * @module Types/Common
 */

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
  tabs: object[];
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
  merge: true;
  open: true;
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

/**
 * @module Types/Tab
 */
export interface TabComponentProps {
  id: string;
  hidden: boolean;
  textColor: string;
  fontWeight: string;
  fontFamily: string;
}

export interface TabState {
  pinned: boolean;
  title: string;
  url: string;
  id?: number;
}

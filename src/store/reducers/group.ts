import { IAction } from "../../typings/reducers";

export const GROUP_ACTIONS = {
  UPDATE_ACTIVE_GROUP: "UPDATE_ACTIVE_GROUP",
  UPDATE_WINDOWS: "UPDATE_WINDOWS"
};

export interface IGroupState {
  activeGroup: string;
  windows: {
    active: boolean;
    id: number;
    tabs: { icon: string; title: string; url: string }[];
  }[];
}

const initState: IGroupState = {
  activeGroup: "Awaiting Storage",
  windows: [
    {
      active: true,
      id: 0,
      tabs: [
        { icon: "icon", title: "Google - 0", url: "https://www.google.com" },
        { icon: "icon", title: "Google - 1", url: "https://www.google.com" },
        { icon: "icon", title: "Google - 2", url: "https://www.google.com" }
      ]
    },
    {
      active: false,
      id: 1,
      tabs: [
        { icon: "icon", title: "Facebook - 0", url: "https://www.facebook.com" },
        { icon: "icon", title: "Facebook - 1", url: "https://www.facebook.com" },
        { icon: "icon", title: "Facebook - 2", url: "https://www.facebook.com" }
      ]
    }
  ]
};

const GroupReducer = (state = initState, action: IAction<IGroupState>): IGroupState => {
  switch (action.type) {
    case GROUP_ACTIONS.UPDATE_ACTIVE_GROUP:
      return { ...state, activeGroup: action.payload };

    case GROUP_ACTIONS.UPDATE_WINDOWS:
      return { ...state, windows: action.payload };

    default:
      return state;
  }
};

export default GroupReducer;

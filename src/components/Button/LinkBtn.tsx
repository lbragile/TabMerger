import React from "react";
import Button from "./Button";
import { DialogProps } from "../Extra/Dialog";
import { setStateType } from "../../typings/common";

export interface LinkBtnProps {
  text: string;
  url: string;
  place?: string;
  icon: JSX.Element;
  tooltip?: boolean;
  onClickFn?: boolean;
  resetTutorialChoice?: (
    e: React.MouseEvent<HTMLButtonElement, MouseEvent>,
    url: string,
    setTour: setStateType<boolean>,
    setDialog: setStateType<DialogProps>
  ) => void;
  setTour?: setStateType<boolean>;
  setDialog?: setStateType<DialogProps>;
}
export default function LinkBtn({
  text,
  url,
  place,
  icon,
  tooltip,
  onClickFn,
  resetTutorialChoice,
  setTour,
  setDialog,
}: LinkBtnProps): JSX.Element {
  return (
    <Button
      id={text.split(" ")[0].toLowerCase() + "-btn"}
      classes="p-0 mx-1 link-global btn-in-global"
      translate={tooltip && text}
      place={place}
      onClick={onClickFn ? (e) => resetTutorialChoice(e, url, setTour, setDialog) : null}
      key={Math.random()}
    >
      {!onClickFn ? (
        <a href={url} rel="noreferrer" target="_blank">
          {icon}
        </a>
      ) : (
        icon
      )}
    </Button>
  );
}

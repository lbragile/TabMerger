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

import React from "react";
import Button from "@Button/Button";
import { setStateType } from "@Typings/common";

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
    setDialog: setStateType<{ show: boolean }>
  ) => void;
  setTour?: setStateType<boolean>;
  setDialog?: setStateType<{ show: boolean }>;
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

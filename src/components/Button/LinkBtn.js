import React from "react";

import Button from "./Button";

export default function LinkBtn({ text, url, icon, tooltip, onClickFn, resetTutorialChoice, setTour, setDialog }) {
  return (
    <Button
      id={text.split(" ")[0].toLowerCase() + "-btn"}
      classes="p-0 mx-1 link-global btn-in-global"
      translate={tooltip && text}
      tooltip={tooltip}
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

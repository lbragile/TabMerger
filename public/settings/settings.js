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

import { restoreOptions, saveOptions, resetOptions } from "./settings_functions.js";

window.addEventListener("load", restoreOptions);
document.getElementById("save-btn").addEventListener("click", saveOptions);
document.getElementById("reset-btn").addEventListener("click", resetOptions);
document.getElementById("home-btn").addEventListener("click", () => location.assign("/index.html"));

[...document.querySelectorAll("input[type='number']")].forEach((x) => {
  x.addEventListener("change", (e) => {
    e.target.value = Math.max(
      +(e.target.name === "json-file-limit"),
      Math.min(e.target.value, e.target.name !== "json-file-limit" ? 24 * 60 : 100)
    ); // clamp between these values (24 * 60 -> 1 day)
  });
});

[...document.querySelectorAll(".label-left")].forEach((x) =>
  x.addEventListener("click", (e) => e.target.closest("div").querySelector(".custom-control-label").click())
);

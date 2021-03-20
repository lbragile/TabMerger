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

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-var */

const path = require("path");
var fs = require("fs");

const input_path = path.join(__dirname, "mainfest_template.json");
const output_path = path.join(__dirname, "../public/manifest.json");

// firefox, chrome, edge
var type = process.argv[process.argv.length - 1].toLowerCase();

fs.readFile(input_path, (err, data) => {
  if (err) throw err;

  // change content based on environment variable
  const manifest = JSON.parse(data);
  if (type === "firefox") {
    manifest.incognito = "spanning";
    manifest.permissions = ["tabs", "contextMenus", "storage", "alarms", "downloads"];
    manifest["browser_specific_settings"] = { gecko: { id: "{19feb84f-3a0b-4ca3-bbae-211b52eb158b}" } };
  } else {
    // chrome or edge
    manifest.incognito = "split";
    if (manifest["browser_specific_settings"]) {
      delete manifest["browser_specific_settings"];
    }
  }

  fs.writeFile(output_path, JSON.stringify(manifest, null, 2), (err) => {
    if (err) throw err;

    console.log(
      "\x1b[36m [INFO] \x1b[0m Saved File: \x1b[32m manifest.json \x1b[0m in \x1b[33m <rootDir>/public/ \x1b[0m"
    );
  });
});

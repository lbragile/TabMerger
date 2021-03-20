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

/* eslint-disable no-var */
/* eslint-disable @typescript-eslint/no-var-requires */

var fs = require("fs");
const { zip } = require("zip-a-folder");

// firefox, chrome, edge
var type = process.argv[process.argv.length - 1].toLowerCase();
const output_name = `./build_${type}.zip`;

const zip_message = (created) =>
  `\x1b[36m [INFO] \x1b[0m ${created ? "\x1b[42m Created" : "\x1b[41m Deleted"} \x1b[0m Zip Folder: \x1b[32m ${output_name.slice(2)} \x1b[0m in \x1b[33m <rootDir>/ \x1b[0m`; // prettier-ignore

// delete the folder if it exists
fs.unlink(output_name, (err) => {
  const log_msg = err
    ? `\x1b[36m [INFO] \x1b[0m Zip Folder: \x1b[32m ${output_name.slice(2)} \x1b[31m does not exist, \x1b[0m creating it...` // prettier-ignore
    : zip_message(false);

  console.log(log_msg);
});

zip("./build", output_name)
  .then(() => console.log(zip_message(true)))
  .catch((err) => console.error(err));

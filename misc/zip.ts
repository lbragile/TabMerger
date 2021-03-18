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

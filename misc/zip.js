const { zip } = require("zip-a-folder");
const fs = require("fs");

// firefox, chrome, edge
const type = process.argv[process.argv.length - 1].toLowerCase();
const output_name = `./build_${type}.zip`;

// delete the folder if it exists
fs.unlink(output_name, (err) => {
  if (err) {
    console.log(`\x1b[36m [INFO] \x1b[0m Zip Folder: \x1b[32m ${output_name.slice(2)} \x1b[31m does not exist, \x1b[0m creating it...`) // prettier-ignore
  } else {
    console.log(`\x1b[36m [INFO] \x1b[0m \x1b[41m Deleted \x1b[0m Zip Folder: \x1b[32m ${output_name.slice(2)} \x1b[0m in \x1b[33m <rootDir>/ \x1b[0m`); // prettier-ignore
  }
});

zip("./build", output_name)
  .then(() => {
    console.log(`\x1b[36m [INFO] \x1b[0m \x1b[42m Created \x1b[0m Zip Folder: \x1b[32m ${output_name.slice(2)} \x1b[0m in \x1b[33m <rootDir>/ \x1b[0m`); // prettier-ignore
  })
  .catch((err) => {
    console.error(err);
  });

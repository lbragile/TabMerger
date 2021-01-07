const { zip } = require('zip-a-folder');

// firefox, chrome, edge
const type = process.argv[process.argv.length - 1].toLowerCase();
const output_name = `./build_${type}.zip`;
zip('./build', output_name)
  .then(() => {
    console.log(`\x1b[36m [INFO] \x1b[0m Made Zip Folder: \x1b[32m ${output_name.slice(2)} \x1b[0m in \x1b[33m <rootDir>/ \x1b[0m`); // prettier-ignore
  })
  .catch((err) => {
    console.error(err);
  });

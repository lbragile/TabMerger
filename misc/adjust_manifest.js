const fs = require("fs");
const path = require("path");

const input_path = path.join(__dirname, "mainfest_template.json");
const output_path = path.join(__dirname, "../public/manifest.json");

// firefox, chrome, edge
const type = process.argv[process.argv.length - 1].toLowerCase();

fs.readFile(input_path, (err, data) => {
  if (err) throw err;

  var manifest = JSON.parse(data);

  // change content based on environment variable
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

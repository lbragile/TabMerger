import React, { useState, useEffect, useRef } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

import Tabs from "./Tab/Tab.js";
import Group from "./Group/Group.js";
import Button from "./Button/Button.js";

import "./Button/Button.css";
import "./App.css";

import { MdSettings, MdDeleteForever, MdAddCircle } from "react-icons/md";
import { FaTrashRestore } from "react-icons/fa";
import { BiImport, BiExport } from "react-icons/bi";
import { BsCloudUpload, BsCloudDownload } from "react-icons/bs";
import { AiOutlineSearch } from "react-icons/ai";

export default function App() {
  const ITEM_STORAGE_LIMIT = useRef(8000); //500 for testing - 8000 for production
  const SYNC_STORAGE_LIMIT = useRef(102000); //1000 for testing - 102000 for production
  const NUM_GROUP_LIMIT = useRef(100); // 3 for testing - 100 for production

  const links = useRef([
    { url: "https://tabmerger.herokuapp.com/", text: "HELP" },
    { url: "https://youtu.be/gx0dNUbwCn4", text: "DEMO" },
    { url: process.env.REACT_APP_PAYPAL_URL, text: "DONATE" },
    { url: getTabMergerLink(true), text: "REVIEW" },
    { url: "https://tabmerger.herokuapp.com/contact", text: "CONTACT" },
  ]);

  var sync_timestamp = useRef();

  const defaultGroup = useRef({
    color: "#dedede",
    created: getTimestamp(),
    title: "Title",
    tabs: [],
  });

  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState();

  function updateTabTotal(ls_entry) {
    var num_tabs = 0;
    Object.values(ls_entry).forEach((val) => {
      num_tabs += val.tabs.length;
    });
    setTabTotal(num_tabs);
  }

  useEffect(() => {
    var default_settings = {
      blacklist: "",
      color: "#dedede",
      dark: true,
      open: "without",
      restore: "keep",
      title: "Title",
    };

    var default_group = {
      color: "#dedede",
      created: getTimestamp(),
      tabs: [],
      title: "Title",
    };

    chrome.storage.sync.get(null, (sync) => {
      if (!sync.settings) {
        chrome.storage.sync.set({ settings: default_settings });
        toggleDarkMode(true);
      } else {
        toggleDarkMode(sync.settings.dark);
      }

      if (sync["group-0"]) {
        toggleSyncTimestamp(true);
      }

      delete sync.settings;
      chrome.storage.local.get("groups", (local) => {
        var ls_entry = local.groups || { "group-0": default_group };

        chrome.storage.local.clear(() => {
          chrome.storage.local.set({ groups: ls_entry }, () => {
            setGroups(JSON.stringify(ls_entry));
            updateTabTotal(ls_entry);
          });
        });
      });
    });
  }, []);

  const updateSync = () => {
    chrome.storage.local.get("groups", async (local) => {
      var current_groups = local.groups;
      if (current_groups !== { "group-0": defaultGroup.current }) {
        for (var key of Object.keys(current_groups)) {
          await updateGroupItem(key, current_groups[key]);
        }

        // remove extras from previous sync
        chrome.storage.sync.get(null, (sync) => {
          delete sync.settings;
          var remove_keys = Object.keys(sync).filter(
            (key) => !Object.keys(current_groups).includes(key)
          );
          chrome.storage.sync.remove(remove_keys, () => {
            toggleSyncTimestamp(true);
          });
        });
      }
    });
  };

  function updateGroupItem(name, value) {
    var sync_entry = {};
    sync_entry[name] = value;

    // need to make sure to only set changed groups
    return new Promise((resolve) => {
      chrome.storage.sync.get(name, (x) => {
        if (
          x[name] === undefined ||
          x[name].color !== value.color ||
          x[name].created !== value.created ||
          x[name].title !== value.title ||
          JSON.stringify(x[name].tabs) !== JSON.stringify(value.tabs)
        ) {
          chrome.storage.sync.set(sync_entry, () => {
            resolve(0);
          });
        } else {
          resolve(0);
        }
      });
    });
  }

  const loadSyncedData = () => {
    chrome.storage.sync.get(null, (sync) => {
      if (sync["group-0"]) {
        delete sync.settings;
        chrome.storage.local.clear(() => {
          var new_ls = {};
          var remove_keys = [];
          Object.keys(sync).forEach((key) => {
            new_ls[key] = sync[key];
            remove_keys.push(key);
          });

          chrome.storage.local.set({ groups: new_ls }, () => {
            chrome.storage.sync.remove(remove_keys, () => {
              toggleSyncTimestamp(false);
              setGroups(JSON.stringify(new_ls));
              updateTabTotal(new_ls);
            });
          });
        });
      }
    });
  };

  function toggleSyncTimestamp(positive) {
    var sync_container = sync_timestamp.current.parentNode;

    if (positive) {
      sync_timestamp.current.innerText = getTimestamp();
      sync_container.classList.replace("alert-danger", "alert-success");
    } else {
      sync_timestamp.current.innerText = "--/--/-- @ --:--:--";
      sync_container.classList.replace("alert-success", "alert-danger");
    }
  }

  useEffect(() => {
    function findSameTab(tab_list, match_url) {
      return tab_list.filter((x) => x.url === match_url);
    }

    const openOrRemoveTabs = (changes, namespace) => {
      if (namespace === "local" && changes.remove && changes.remove.newValue) {
        // extract and remove the button type from array
        var btn_type = changes.remove.newValue[0];
        changes.remove.newValue.splice(0, 1);

        // try to not open tabs if it is already open
        chrome.tabs.query({ currentWindow: true }, (windowTabs) => {
          for (var i = 0; i < changes.remove.newValue.length; i++) {
            var tab_url = changes.remove.newValue[i];
            var same_tab = findSameTab(windowTabs, tab_url);
            if (same_tab[0]) {
              chrome.tabs.move(same_tab[0].id, { index: -1 });
            } else {
              chrome.tabs.create({ url: tab_url, active: false });
            }
          }

          // remove tab if needed
          chrome.storage.sync.get("settings", (sync) => {
            chrome.storage.local.get("groups", (local) => {
              var group_blocks = local.groups;
              if (sync.settings.restore !== "keep") {
                if (btn_type !== "all") {
                  var any_tab_url = changes.remove.newValue[0];
                  var elem = document.querySelector(`a[href='${any_tab_url}']`);
                  var group_id = elem.closest(".group").id;
                  group_blocks[group_id].tabs = group_blocks[
                    group_id
                  ].tabs.filter(
                    (x) => !changes.remove.newValue.includes(x.url)
                  );
                } else {
                  Object.keys(group_blocks).forEach((key) => {
                    group_blocks[key].tabs = [];
                  });
                }

                chrome.storage.local.set({ groups: group_blocks }, () => {
                  // update global counter
                  setTabTotal(
                    document.querySelectorAll(".draggable").length -
                      changes.remove.newValue.length
                  );

                  setGroups(JSON.stringify(group_blocks));
                });
              }

              // allow reopening same tab
              chrome.storage.local.remove(["remove"]);
            });
          });
        });
      }
    };

    const checkMerging = (changes, namespace) => {
      if (
        namespace === "local" &&
        changes.merged_tabs &&
        changes.merged_tabs.newValue &&
        changes.merged_tabs.newValue.length !== 0
      ) {
        chrome.storage.local.get(
          ["merged_tabs", "into_group", "groups"],
          (local) => {
            // prettier-ignore
            var into_group = local.into_group, merged_tabs = local.merged_tabs;
            var group_blocks = local.groups;
            var merged_bytes = JSON.stringify(merged_tabs).length;

            var sync_bytes = JSON.stringify(group_blocks).length + merged_bytes;

            if (sync_bytes < SYNC_STORAGE_LIMIT.current) {
              var this_group = group_blocks[into_group];
              var item_bytes = JSON.stringify(this_group).length + merged_bytes;

              // // prettier-ignore
              // console.log(item_bytes, "item", sync_bytes, "sync", merged_bytes, "merge");

              if (item_bytes < ITEM_STORAGE_LIMIT.current) {
                // close tabs to avoid leaving some open
                chrome.tabs.remove(merged_tabs.map((x) => x.id));

                var tabs_arr = [...this_group.tabs, ...merged_tabs];
                tabs_arr = tabs_arr.map((x) => ({
                  title: x.title,
                  url: x.url,
                }));

                group_blocks[into_group].tabs = tabs_arr;

                chrome.storage.local.set({ groups: group_blocks }, () => {
                  var current = document.querySelectorAll(".draggable");
                  setTabTotal(current.length + merged_tabs.length);
                  setGroups(JSON.stringify(group_blocks));
                });
              } else {
                alert(
                  `Group's syncing capacity exceeded by ${
                    item_bytes - ITEM_STORAGE_LIMIT.current
                  } bytes.\n\nPlease do one of the following:
      1. Create a new group and merge new tabs into it;
      2. Remove some tabs from this group;
      3. Merge less tabs into this group (each tab is ~100-300 bytes).`
                );
              }
            } else {
              alert(
                `Total syncing capacity exceeded by ${
                  sync_bytes - SYNC_STORAGE_LIMIT.current
                } bytes.\n\nPlease do one of the following:
      1. Remove some tabs from any group;
      2. Delete a group that is no longer needed;
      3. Merge less tabs into this group (each tab is ~100-300 bytes).
      \nMake sure to Export JSON or PDF to have a backup copy!`
              );
            }

            // remove to be able to detect changes again (even for same tabs)
            chrome.storage.local.remove(["into_group", "merged_tabs"]);
          }
        );
      }
    };

    chrome.storage.onChanged.addListener(openOrRemoveTabs);
    chrome.storage.onChanged.addListener(checkMerging);

    return () => {
      chrome.storage.onChanged.removeListener(openOrRemoveTabs);
      chrome.storage.onChanged.removeListener(checkMerging);
    };
  }, []);

  function sortByKey(json) {
    var sortedArray = [];

    // Push each JSON Object entry in array by [key, value]
    for (var i in json) {
      sortedArray.push([i, json[i]]);
    }

    return sortedArray.sort((a, b) => {
      var opts = { numeric: true, sensitivity: "base" };
      return a[0].localeCompare(b[0], undefined, opts);
    });
  }

  const groupFormation = () => {
    if (groups) {
      var sorted_vals;
      var group_blocks = JSON.parse(groups);
      if (Object.keys(group_blocks).length > 1) {
        var sorted_groups = sortByKey(JSON.parse(groups));
        sorted_vals = sorted_groups.map((x) => x[1]);
      } else {
        sorted_vals = Object.values(group_blocks);
      }
      return sorted_vals.map((x, i) => {
        var id = "group-" + i;
        return (
          <Group
            id={id}
            className="group"
            title={x.title}
            color={x.color}
            created={x.created}
            num_tabs={(x.tabs && x.tabs.length) || 0}
            setGroups={setGroups}
            setTabTotal={setTabTotal}
            getTimestamp={getTimestamp}
            key={Math.random()}
          >
            <Tabs
              id={id}
              itemLimit={ITEM_STORAGE_LIMIT.current}
              setTabTotal={setTabTotal}
              setGroups={setGroups}
            />
          </Group>
        );
      });
    }
  };

  function getTimestamp() {
    var date_parts = new Date(Date.now()).toString().split(" ");
    date_parts = date_parts.filter((_, i) => 0 < i && i <= 4);

    // dd/mm/yyyy @ hh:mm:ss
    date_parts[0] = date_parts[1] + "/";
    date_parts[1] = new Date().getMonth() + 1 + "/";
    date_parts[2] += " @ ";

    return date_parts.join("");
  }

  const addGroup = () => {
    chrome.storage.local.get("groups", (local) => {
      var current_groups = local.groups;
      var num_keys = Object.keys(current_groups).length;

      if (num_keys < NUM_GROUP_LIMIT.current) {
        chrome.storage.sync.get("settings", (sync) => {
          defaultGroup.current.created = getTimestamp();
          defaultGroup.current.color = sync.settings.color;
          defaultGroup.current.title = sync.settings.title;
          current_groups["group-" + num_keys] = defaultGroup.current;
          chrome.storage.local.set({ groups: current_groups }, () => {
            setGroups(JSON.stringify(current_groups));
          });
        });
      } else {
        alert(
          `Number of groups exceeded.\n\nPlease do one of the following:
  1. Delete a group that is no longer needed;
  2. Merge tabs into another existing group.`
        );
      }
    });
  };

  function openAllTabs() {
    // ["all", ... url_links ...]
    var tab_links = [...document.querySelectorAll(".a-tab")].map((x) => x.href);
    tab_links.unshift("all");
    chrome.storage.local.set({ remove: tab_links });
  }

  function deleteAllGroups() {
    chrome.storage.sync.get("settings", (sync) => {
      defaultGroup.current.created = getTimestamp();
      defaultGroup.current.color = sync.settings.color;
      defaultGroup.current.title = sync.settings.title;

      var new_entry = { "group-0": defaultGroup.current };
      chrome.storage.local.set({ groups: new_entry }, () => {
        setTabTotal(0);
        setGroups(JSON.stringify(new_entry));
      });
    });
  }

  function toggleDarkMode(isChecked) {
    var container = document.querySelector("body");
    var hr = document.querySelector("hr");
    var links = document.getElementsByClassName("link");

    container.style.background = isChecked ? "rgb(52, 58, 64)" : "white";
    container.style.color = isChecked ? "white" : "black";
    hr.style.borderTop = isChecked
      ? "1px white solid"
      : "1px rgba(0,0,0,.1) solid";

    [...links].forEach((x) => {
      x.style.color = isChecked ? "white" : "black";
    });
  }

  function filterRegEx(e) {
    // prettier-ignore
    var sections, titles, match, tab_items, search_type, no_match, keep_sections = [];
    sections = document.querySelectorAll(".group-item");

    if (e.target.value[0] === "#") {
      titles = [...sections].map((x) => x.querySelector("p").innerText);
      match = e.target.value.substr(1).toLowerCase();
      search_type = "group";
    } else if (e.target.value !== "") {
      tab_items = [...sections].map((x) => [
        ...x.querySelectorAll(".draggable"),
      ]);
      titles = tab_items.map((x) => {
        return x.map((y) => y.lastChild.innerText.toLowerCase());
      });

      match = e.target.value.toLowerCase();
      search_type = "tab";
    } else {
      // no typing? show all groups and tabs
      sections.forEach((x) => (x.style.display = ""));
      [...document.querySelectorAll(".draggable")].forEach(
        (x) => (x.style.display = "")
      );
    }

    if (search_type === "group") {
      titles.forEach((x, i) => {
        no_match = x.toLowerCase().indexOf(match) === -1;
        sections[i].style.display = no_match ? "none" : "";
      });
    } else if (search_type === "tab") {
      titles.forEach((title, i) => {
        // individual tabs where a group has 1 tab matching
        title.forEach((x, j) => {
          // maintain a list of groups to keep since
          // they contain at least one match
          no_match = x.indexOf(match) === -1;

          if (!no_match) {
            keep_sections.push(i);
          }

          tab_items[i][j].style.display = no_match ? "none" : "";
        });
      });

      // remove groups based on above calculations
      sections.forEach((x, i) => {
        x.style.display = !keep_sections.includes(i) ? "none" : "";
      });
    }
  }

  function readImportedFile(e) {
    if (e.target.files[0].type === "application/json") {
      var reader = new FileReader();
      reader.readAsText(e.target.files[0]);
      reader.onload = () => {
        var fileContent = JSON.parse(reader.result);

        chrome.storage.sync.set({ settings: fileContent.settings }, () => {
          delete fileContent.settings;
          chrome.storage.local.set({ groups: fileContent }, () => {
            setGroups(JSON.stringify(fileContent));
            updateTabTotal(fileContent);
          });
        });
      };
    } else {
      alert(
        `You must import a JSON file (.json extension)!\n
These can be generated via the "Export JSON" button.\n\n
Be careful, only import JSON files generated by TabMerger, otherwise you risk losing your current configuration!`
      );
    }
  }

  const exportJSON = () => {
    chrome.storage.local.get("groups", (local) => {
      var group_blocks = local.groups;
      chrome.storage.sync.get("settings", (sync) => {
        group_blocks["settings"] = sync.settings;

        var dataStr =
          "data:text/json;charset=utf-8," +
          encodeURIComponent(JSON.stringify(group_blocks, null, 2));

        var anchor = document.createElement("a");
        anchor.setAttribute("href", dataStr);
        anchor.setAttribute("download", outputFileName() + ".json");
        anchor.click();
        anchor.remove();
      });
    });
  };

  function outputFileName() {
    const timestamp = new Date(Date.now()).toString().split(" ").slice(1, 5);
    const date_str = timestamp.slice(0, 3).join("-");

    return `TabMerger [${date_str} @ ${timestamp[3]}]`;
  }

  function getTabMergerLink(reviews) {
    var link;
    var isOpera = navigator.userAgent.indexOf(" OPR/") >= 0;
    var isFirefox = typeof InstallTrigger !== "undefined";
    var isIE = /*@cc_on!@*/ false || !!document.documentMode;
    var isEdge = !isIE && !!window.StyleMedia;
    var isChrome = !!window.chrome && !!window.chrome.runtime;
    var isEdgeChromium = isChrome && navigator.userAgent.indexOf("Edg") !== -1;

    if (isIE || isEdge || isEdgeChromium) {
      link =
        "https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn";
    } else if (isFirefox) {
      link = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
    } else if (isChrome || isOpera) {
      link =
        "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
    }

    if (reviews && !isFirefox) {
      link += "/reviews/";
    }
    return link;
  }

  function translate(msg) {
    return chrome.i18n.getMessage(msg);
  }

  return (
    <div className="container-fluid">
      <div className="row link-container mt-4 mr-2">
        {links.current.map((x, i) => {
          return (
            <>
              <a className="link" href={x.url} target="_blank" rel="noreferrer">
                {x.text}
              </a>
              <span style={{ padding: "0 5px" }}>
                {i === links.current.length - 1 ? "" : " | "}
              </span>
            </>
          );
        })}
      </div>

      <div className="col" id="tabmerger-container">
        <div>
          <a href={getTabMergerLink(false)}>
            <img
              id="logo-img"
              className="my-4"
              src="./images/logo-full-rescale.PNG"
              alt="TabMerger Logo"
            />
          </a>
          <div className="subtitle">
            <h2 id="tab-total" className="mb-0">
              <span className="small">
                {tabTotal + (tabTotal === 1 ? " Tab" : " Tabs")}
              </span>
            </h2>

            <div className="input-group search-filter">
              <div className="input-group-prepend">
                <span className="input-group-text">
                  <AiOutlineSearch />
                </span>
              </div>
              <input
                type="text"
                name="search-group"
                placeholder="#_ &rarr; group, _ &rarr; tab"
                onChange={(e) => filterRegEx(e)}
              />
            </div>
          </div>
          <hr />
        </div>
        <div className="container-below-hr mt-3">
          <div className="global-btn-row row">
            <Button
              id="open-all-btn"
              classes="p-0 ml-3 btn-in-global"
              translate={translate("openAll")}
              tooltip={"tiptext-global"}
              onClick={() => openAllTabs()}
            >
              <FaTrashRestore color="green" />
            </Button>

            <Button
              id="delete-all-btn"
              classes="ml-1 mr-4 p-0 btn-in-global"
              translate={translate("deleteAll")}
              tooltip={"tiptext-global"}
              onClick={() => deleteAllGroups()}
            >
              <MdDeleteForever color="red" />
            </Button>

            <Button
              id="export-btn"
              classes="ml-4 btn-in-global"
              translate={translate("exportJSON")}
              tooltip={"tiptext-json"}
              onClick={exportJSON}
            >
              <BiExport color="darkcyan" size="1.4rem" />
            </Button>

            <div>
              <label
                id="import-btn"
                for="import-input"
                className="ml-1 mr-4 my-0 btn-in-global btn"
              >
                <div className="tip">
                  <BiImport color="darkcyan" size="1.4rem" />
                  <span className="tiptext-json">
                    {translate("importJSON")}
                  </span>
                </div>
              </label>
              <input
                id="import-input"
                type="file"
                accept=".json"
                onChange={(e) => readImportedFile(e)}
              ></input>
            </div>

            <Button
              id="sync-write-btn"
              classes="ml-4 p-0 btn-in-global"
              translate={"Sync Write"}
              tooltip={"tiptext-global"}
              onClick={updateSync}
            >
              <BsCloudUpload color="black" size="1.5rem" />
            </Button>

            <Button
              id="sync-read-btn"
              classes="ml-1 p-0 btn-in-global"
              translate={"Sync Read"}
              tooltip={"tiptext-global"}
              onClick={loadSyncedData}
            >
              <BsCloudDownload color="black" size="1.5rem" />
            </Button>

            <p className="alert alert-danger" id="sync-text">
              <b>Last Sync:</b>{" "}
              <span ref={sync_timestamp}>--/--/---- @ --:--:--</span>
            </p>

            <Button
              id="options-btn"
              classes="p-0 btn-in-global"
              translate={translate("settings")}
              tooltip={"tiptext-global"}
              onClick={() => window.location.replace("/options.html")}
            >
              <MdSettings color="grey" size="1.6rem" />
            </Button>
          </div>
          <div className="groups-container">
            {groupFormation() ? groupFormation() : null}

            <Button
              id="add-group-btn"
              classes="d-block btn-in-global mt-1 ml-3 p-2"
              translate={translate("addGroup")}
              tooltip={"tiptext-global"}
              onClick={() => addGroup()}
            >
              <MdAddCircle
                color="#dedede"
                size="2rem"
                stroke="grey"
                strokeWidth="1px"
              />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

import Tabs from "./Tabs.js";
import Group from "./Group.js";
import Button from "./Button.js";

import "./App.css";
import "./Button.css";

import { MdSettings, MdDeleteForever, MdAddCircle } from "react-icons/md";
import { FaTrashRestore, FaFilePdf } from "react-icons/fa";
import { BiImport, BiExport } from "react-icons/bi";
import { AiOutlineSearch } from "react-icons/ai";

import jsPDF from "jspdf";

export default function App() {
  const ITEM_STORAGE_LIMIT = useRef(500); //500 for testing - 8000 for production
  const SYNC_STORAGE_LIMIT = useRef(1000); //1000 for testing - 102000 for production
  const NUM_GROUP_LIMIT = useRef(100); // 3 for testing - 100 for production

  const defaultGroup = useRef({
    color: "#dedede",
    created: getTimestamp(),
    title: "Title",
    tabs: [],
  });

  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState(
    localStorage.getItem("groups") ||
      JSON.stringify({ "group-0": defaultGroup.current })
  );

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
          chrome.storage.sync.get("settings", (result) => {
            var group_blocks = JSON.parse(localStorage.getItem("groups"));
            if (result.settings.restore !== "keep") {
              if (btn_type !== "all") {
                var any_tab_url = changes.remove.newValue[0];
                var elem = document.querySelector(`a[href='${any_tab_url}']`);
                var group_id = elem.closest(".group").id;
                group_blocks[group_id].tabs = group_blocks[
                  group_id
                ].tabs.filter((x) => !changes.remove.newValue.includes(x.url));
              } else {
                Object.keys(group_blocks).forEach((key) => {
                  group_blocks[key].tabs = [];
                });
              }

              localStorage.setItem("groups", JSON.stringify(group_blocks));

              // update global counter
              setTabTotal(
                document.querySelectorAll(".draggable").length -
                  changes.remove.newValue.length
              );

              setGroups(JSON.stringify(group_blocks));
            }

            // allow reopening same tab
            chrome.storage.local.remove(["remove"]);
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
        chrome.storage.local.get(["merged_tabs", "into_group"], (local) => {
          // prettier-ignore
          var into_group = local.into_group, merged_tabs = local.merged_tabs;
          var group_blocks = localStorage.getItem("groups");
          var merged_bytes = JSON.stringify(merged_tabs).length;

          var sync_bytes = JSON.stringify(group_blocks).length + merged_bytes;

          if (sync_bytes < SYNC_STORAGE_LIMIT.current) {
            var this_group = JSON.parse(group_blocks)[into_group];
            var item_bytes = JSON.stringify(this_group).length + merged_bytes;

            // prettier-ignore
            console.log(item_bytes, "item", sync_bytes, "sync", merged_bytes, "merge");

            if (item_bytes < ITEM_STORAGE_LIMIT.current) {
              // close tabs to avoid leaving some open
              chrome.tabs.remove(merged_tabs.map((x) => x.id));

              var tabs_arr = [...this_group.tabs, ...merged_tabs];
              tabs_arr = tabs_arr.map((x) => ({
                title: x.title,
                url: x.url,
              }));

              var existing_groups = JSON.parse(localStorage.getItem("groups"));
              existing_groups[into_group].tabs = tabs_arr;

              localStorage.setItem("groups", JSON.stringify(existing_groups));

              var current = document.querySelectorAll(".draggable");
              setTabTotal(current.length + merged_tabs.length);
              setGroups(JSON.stringify(existing_groups));
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
        });
      }
    };

    async function updateSync() {
      if (
        localStorage.getItem("groups") !==
        JSON.stringify({ "group-0": defaultGroup.current })
      ) {
        var current_groups = JSON.parse(localStorage.getItem("groups"));
        for (var key of Object.keys(current_groups)) {
          await updateGroupItem(key, current_groups[key]);
        }
        chrome.storage.sync.get(null, (result) => {
          delete result.settings;
          var remove_keys = Object.keys(result).filter(
            (key) => !Object.keys(current_groups).includes(key)
          );
          chrome.storage.sync.remove(remove_keys, () => {
            chrome.storage.sync.get(null, (result) => {
              console.log("This is printed for your information only:");
              Object.keys(result).forEach((key) => {
                console.log(
                  `[INFO] Synced: ${key} -> ${JSON.stringify(result[key])}`
                );
              });
            });
          });
        });
      }
    }

    // set dark mode if needed & assign default values to state variables
    chrome.storage.sync.get("settings", (result) => {
      toggleDarkMode(result.settings.dark);
    });

    setTabTotal(document.querySelectorAll(".draggable").length);

    chrome.storage.onChanged.addListener(openOrRemoveTabs);
    chrome.storage.onChanged.addListener(checkMerging);
    window.addEventListener("beforeunload", updateSync());

    return () => {
      chrome.storage.onChanged.removeListener(openOrRemoveTabs);
      chrome.storage.onChanged.removeListener(checkMerging);
      window.removeEventListener("beforeunload", updateSync());
    };
  }, []);

  const groupFormation = (group_items) => {
    return Object.values(JSON.parse(group_items)).map((x, i) => {
      var id = "group-" + i;
      return (
        <Group
          id={id}
          className="group"
          title={x.title}
          color={x.color}
          created={x.created}
          num_tabs={(x.tabs && x.tabs.length) || 0}
          groups={groups}
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
    var current_groups = JSON.parse(localStorage.getItem("groups"));
    var num_keys = Object.keys(current_groups).length;

    if (num_keys < NUM_GROUP_LIMIT.current) {
      chrome.storage.sync.get("settings", (result) => {
        defaultGroup.current.created = getTimestamp();
        defaultGroup.current.color = result.settings.color;
        defaultGroup.current.title = result.settings.title;
        current_groups["group-" + num_keys] = defaultGroup.current;
        localStorage.setItem("groups", JSON.stringify(current_groups));
        setGroups(JSON.stringify(current_groups));
      });
    } else {
      alert(
        `Number of groups exceeded.\n\nPlease do one of the following:
1. Delete a group that is no longer needed;
2. Merge tabs into another existing group.`
      );
    }
  };

  function openAllTabs() {
    // ["all", ... url_links ...]
    var tab_links = [...document.querySelectorAll(".a-tab")].map((x) => x.href);
    tab_links.unshift("all");
    chrome.storage.local.set({ remove: tab_links });
  }

  function deleteAllGroups() {
    chrome.storage.sync.get("settings", (result) => {
      defaultGroup.current.created = getTimestamp();
      defaultGroup.current.color = result.settings.color;
      defaultGroup.current.title = result.settings.title;

      var new_entry = JSON.stringify({ "group-0": defaultGroup.current });
      localStorage.setItem("groups", new_entry);
      setTabTotal(0);
      setGroups(new_entry);
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
    var sections, titles, match, tab_items;
    sections = document.querySelectorAll(".group-item");

    if (e.target.value[0] === "#") {
      titles = [...sections].map((x) => x.querySelector("p").innerText);
      match = e.target.value.substr(1);
    } else {
      // if a group has no tabs must hide it when typing
      if (e.target.value.length > 0) {
        sections.forEach((x) => {
          var num_tabs = x.querySelector(".draggable");
          if (!num_tabs) {
            x.style.display = "none";
          }
        });
      } else {
        sections.forEach((x) => (x.style.display = ""));
      }

      tab_items = document.querySelectorAll(".draggable");
      titles = [...tab_items].map((x) => x.lastChild.innerText);
      match = e.target.value;
    }

    titles.forEach((x, i) => {
      var title_in_filter = x.toLowerCase().indexOf(match.toLowerCase()) === -1;
      sections[i].style.display = title_in_filter ? "none" : "";
    });
  }

  function readImportedFile(e) {
    if (e.target.files[0].type === "application/json") {
      var reader = new FileReader();
      reader.readAsText(e.target.files[0]);
      reader.onload = () => {
        var fileContent = JSON.parse(reader.result);

        chrome.storage.sync.set({ settings: fileContent.settings }, () => {
          delete fileContent.settings;
          localStorage.setItem("groups", JSON.stringify(fileContent));
          setGroups(JSON.stringify(fileContent));

          var sum = 0;
          Object.values(fileContent).forEach((val) => {
            sum += val.tabs.length;
          });

          setTabTotal(sum);
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
    setGroups(groups);

    var group_blocks = JSON.parse(localStorage.getItem("groups"));
    chrome.storage.sync.get("settings", (result) => {
      group_blocks["settings"] = result.settings;

      var dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(group_blocks, null, 2));

      var anchor = document.createElement("a");
      anchor.setAttribute("href", dataStr);
      anchor.setAttribute("download", outputFileName() + ".json");
      anchor.click();
      anchor.remove();
    });
  };

  function outputFileName() {
    const timestamp = new Date(Date.now()).toString().split(" ").slice(1, 5);
    const date_str = timestamp.slice(0, 3).join("-");

    return `TabMerger [${date_str} @ ${timestamp[3]}]`;
  }

  // clean the titles so that they are UTF-8 friendly
  function cleanString(input) {
    var output = "";
    for (var i = 0; i < input.length; i++) {
      if (input.charCodeAt(i) <= 127) {
        output += input.charAt(i);
      }
    }
    return output;
  }

  function addPage(doc, y, height) {
    if (y >= height - 20) {
      doc.addPage();
      y = 15;
    }

    return y;
  }

  function exportPDF() {
    var doc = new jsPDF();

    var { width, height } = doc.internal.pageSize;
    // prettier-ignore
    var x = 25, y = 50;

    // prettier-ignore
    doc.addImage("./images/logo-full-rescale.PNG", x - 5,  y - 25, 74.4, 14);
    doc.setFontSize(11);
    doc.text("Get TabMerger Today:", x + 90, y - 15);
    doc.setTextColor(51, 153, 255);
    doc.textWithLink("Chrome", x + 131, y - 15, {
      url:
        "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc",
    });
    doc.setTextColor("#000");
    doc.text("|", x + 146, y - 15);
    doc.setTextColor(51, 153, 255);
    doc.textWithLink("FireFox", x + 149, y - 15, {
      url: "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger/",
    });
    doc.addImage("./images/logo128.png", "PNG", width - 20, y - 20, 5, 5);

    doc.setFontSize(16);
    doc.setTextColor("000");
    doc.text(tabTotal + " tabs in total", x - 5, y);

    var result = JSON.parse(localStorage.getItem("groups"));
    Object.values(result).forEach((item) => {
      // rectangle around the group
      doc.setFillColor(item.color);

      var group_height =
        item.tabs.length > 0
          ? 10 * (item.tabs.length + 1)
          : 10 * (item.tabs.length + 2);

      // make sure group height never exceeds the page limit
      if (y + group_height > height - 20) {
        var extra = 5;
        group_height = height - 20 - y - extra;
      }

      doc.roundedRect(x - 5, y + 8, 175, group_height, 1, 1, "F");

      y += 15;
      y = addPage(doc, y, height);

      doc.setTextColor("#000");
      doc.setFontSize(16);
      doc.text(item.title, x - 3, y);

      doc.setFontSize(12);

      // if tabs in the group exist
      if (item.tabs.length > 0) {
        item.tabs.forEach((tab, index) => {
          y += 10;
          y = addPage(doc, y, height);

          doc.setTextColor("#000");
          doc.text(index + 1 + ".", x + 5, y);
          doc.setTextColor(51, 153, 255);

          var title =
            tab.title.length > 75 ? tab.title.substr(0, 75) + "..." : tab.title;

          doc.textWithLink(cleanString(title), index < 9 ? x + 11 : x + 13, y, {
            url: tab.url,
          });
        });
      } else {
        doc.setTextColor("#000");
        doc.text("[ NO TABS IN GROUP ]", x + 5, y + 10);
        y += 10;
      }
    });

    // page numbers
    doc.setTextColor("#000");
    var pageCount = doc.internal.getNumberOfPages();
    for (var i = 0; i < pageCount; i++) {
      doc.setPage(i);
      doc.text(
        width / 2 - 20,
        height - 5,
        "Page " +
          doc.internal.getCurrentPageInfo().pageNumber +
          " of " +
          pageCount
      );

      doc.text(width - 50, height - 5, "© Lior Bragilevsky");
    }

    doc.save(outputFileName() + ".pdf");
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
        {[
          { url: "https://tabmerger.herokuapp.com/", text: "HELP" },
          { url: "https://youtu.be/gx0dNUbwCn4", text: "DEMO" },
          {
            url:
              "https://www.paypal.com/donate?hosted_button_id=X3EYMX8CVA4SY&source=url",
            text: "DONATE",
          },
          { url: getTabMergerLink(true), text: "REVIEW" },
        ].map((x, i) => {
          return (
            <>
              <a className="link" href={x.url} target="_blank" rel="noreferrer">
                {x.text}
              </a>
              <span style={{ padding: "0 5px" }}>{i === 3 ? "" : " | "}</span>
            </>
          );
        })}
      </div>

      <div className="col" id="tabmerger-container">
        <div>
          <a href={getTabMergerLink(false)}>
            <img
              id="logo-img"
              className="mt-4"
              src="./images/logo-full-rescale.PNG"
              alt="TabMerger Logo"
            />
          </a>
          <div>
            <h2 id="tab-total">
              <span className="small">
                {tabTotal}{" "}
                {tabTotal === 1
                  ? translate("pageTotalSingular")
                  : translate("pageTotalPlural")}
              </span>
            </h2>

            <div className="input-group search-filter float-right">
              <div className="input-group-prepend">
                <span className="input-group-text">
                  <AiOutlineSearch />
                </span>
              </div>
              <input
                type="text"
                name="search-group"
                className="mr-2"
                placeholder="#_&rarr; group, _&rarr; tab"
                onChange={(e) => filterRegEx(e)}
              />
            </div>
          </div>
          <hr />
        </div>
        <div className="container-below-hr">
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
                className="mx-1 my-0 btn-in-global btn"
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
              id="pdf-btn"
              classes="p-0 btn-in-global"
              translate={translate("exportPDF")}
              tooltip={"tiptext-global"}
              onClick={() => exportPDF()}
            >
              <FaFilePdf color="purple" size="1.5rem" />
            </Button>

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
            <table>
              {groupFormation(groups).map((x, i) => {
                if (i % 2 === 0) {
                  return (
                    <tr>
                      <td className="align-top">{x}</td>
                      {groupFormation(groups)[i + 1] ? (
                        <td className="align-top">
                          {groupFormation(groups)[i + 1]}
                        </td>
                      ) : (
                        <td className="align-top"></td>
                      )}
                    </tr>
                  );
                }
              })}
            </table>

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

import React, { useState, useEffect, useRef, useCallback } from "react";
import "bootstrap/dist/css/bootstrap.min.css";

import Tabs from "./Tabs.js";
import Group from "./Group.js";
import Button from "./Button.js";

import "./App.css";
import "./Button.css";

import { MdSettings, MdDeleteForever, MdAddCircle } from "react-icons/md";
// prettier-ignore
import { FaTrashRestore, FaFileImport, FaFileExport, FaFilePdf } from "react-icons/fa";
import { RiStarSFill } from "react-icons/ri";

import jsPDF from "jspdf";

export default function App() {
  const ITEM_STORAGE_LIMIT = useRef(8000); //500 for testing - 8000 for production
  const SYNC_STORAGE_LIMIT = useRef(102000); //1000 for testing - 102000 for production
  const NUM_GROUP_LIMIT = useRef(300); // 3 for testing - 3000 for production

  const [color, setColor] = useState("#dedede");
  const [title, setTitle] = useState("Title");
  const defaultGroup = useRef({
    title,
    color,
    created: new Date(Date.now()).toString(),
    tabs: [],
  });

  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState(
    JSON.stringify({ "group-0": defaultGroup.current })
  );

  function findSameTab(tab_list, match_url) {
    return tab_list.filter((x) => x.url === match_url);
  }

  const openOrRemoveTabs = useCallback((changes, namespace) => {
    if (namespace === "local" && changes.remove && changes.remove.newValue) {
      // extract and remove the button type from array
      var btn_type = changes.remove.newValue[0];
      changes.remove.newValue.splice(0, 1);

      // try to not open tabs if it is already open
      chrome.tabs.query({ currentWindow: true }, (windowTabs) => {
        chrome.storage.sync.get(null, (result) => {
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
          if (result.settings.restore !== "keep") {
            if (btn_type !== "all") {
              var any_tab_url = changes.remove.newValue[0];
              var elem = document.querySelector(`a[href='${any_tab_url}']`);
              var group_id = elem.closest(".group").id;
              result[group_id].tabs = result[group_id].tabs.filter(
                (x) => !changes.remove.newValue.includes(x.url)
              );
              updateGroupItem(group_id, result[group_id]);
            } else {
              // set all
              Object.keys(result).forEach((key) => {
                if (key !== "settings") {
                  result[key].tabs = [];
                  updateGroupItem(key, result[key]);
                }
              });
            }

            // update global counter
            setTabTotal(
              document.querySelectorAll(".draggable").length -
                changes.remove.newValue.length
            );

            // update groups
            delete result.settings;
            setGroups(JSON.stringify(result));
          }
        });
      });

      // in case "Keep in TabMerger" setting, this allows to open multiple times
      chrome.storage.local.remove("remove");
    }
  }, []);

  const checkMerging = useCallback((changes, namespace) => {
    if (
      namespace === "local" &&
      changes.merged_tabs &&
      changes.merged_tabs.newValue &&
      changes.merged_tabs.newValue.length !== 0
    ) {
      chrome.storage.local.get(["merged_tabs", "into_group"], (local) => {
        // prettier-ignore
        var into_group = local.into_group, merged_tabs = local.merged_tabs;
        chrome.storage.sync.getBytesInUse(null, (syncBytesInUse) => {
          var sync_bytes = syncBytesInUse + JSON.stringify(merged_tabs).length;
          if (sync_bytes < SYNC_STORAGE_LIMIT.current) {
            chrome.storage.sync.getBytesInUse(into_group, (itemBytesInUse) => {
              var item_bytes =
                itemBytesInUse + JSON.stringify(merged_tabs).length;

              if (item_bytes < ITEM_STORAGE_LIMIT.current) {
                // close tabs to avoid leaving some open
                chrome.tabs.remove(merged_tabs.map((x) => x.id));

                chrome.storage.sync.get(null, (sync) => {
                  delete sync.settings;

                  var tabs_arr = [...sync[into_group].tabs, ...merged_tabs];
                  tabs_arr = tabs_arr.map((x) => ({
                    url: x.url,
                    favIconUrl: x.favIconUrl,
                    title: x.title,
                  }));

                  var current = document.querySelectorAll(".draggable");
                  setTabTotal(current.length + merged_tabs.length);

                  sync[into_group].tabs = tabs_arr;
                  updateGroupItem(into_group, sync[into_group]);
                  setGroups(JSON.stringify(sync));
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
            });
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

          // remove to be able to detect changes again
          // (even if same tabs are needed to be merged)
          chrome.storage.local.remove(["into_group", "merged_tabs"]);
        });
      });
    }
  }, []);

  useEffect(() => {
    chrome.runtime.setUninstallURL("https://tabmerger.herokuapp.com/survey");

    // set dark mode if needed & assign default values to state variables
    chrome.storage.sync.get(null, (result) => {
      var json = { target: { checked: null } };
      var darkModeSwitch = document.getElementById("darkMode");
      darkModeSwitch.checked = result.settings.dark;
      json.target.checked = result.settings.dark;

      toggleDarkMode(json);

      // state variables
      setColor(result.settings.color);
      setTitle(result.settings.title);
      delete result.settings; // delete but do not update sync storage;

      var sum = 0;
      Object.keys(result).forEach((key) => (sum += result[key].tabs.length));

      setTabTotal(sum);
      setGroups(JSON.stringify(result));
    });

    chrome.storage.onChanged.addListener(checkMerging);
    chrome.storage.onChanged.addListener(openOrRemoveTabs);

    return () => {
      chrome.storage.onChanged.removeListener(checkMerging);
      chrome.storage.onChanged.removeListener(openOrRemoveTabs);
    };
  }, [checkMerging, openOrRemoveTabs]);

  useEffect(() => {
    if (groups !== JSON.stringify({ "group-0": defaultGroup.current })) {
      var parsed_groups = JSON.parse(groups);
      Object.keys(parsed_groups).forEach((key) => {
        updateGroupItem(key, parsed_groups[key]);
      });
    }
  }, [groups]);

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
          key={Math.random()}
          setColor={setColor}
          setTitle={setTitle}
          setGroups={setGroups}
          setTabTotal={setTabTotal}
        >
          <Tabs
            itemLimit={ITEM_STORAGE_LIMIT.current}
            setTabTotal={setTabTotal}
            id={id}
            setGroups={setGroups}
          />
        </Group>
      );
    });
  };

  function updateGroupItem(name, value) {
    var storage_entry = {};
    storage_entry[name] = value;
    chrome.storage.sync.set(storage_entry, () => {});
  }

  const addGroup = () => {
    var current_groups = JSON.parse(groups);
    var num_keys = Object.keys(current_groups).length;

    if (num_keys < NUM_GROUP_LIMIT.current) {
      chrome.storage.sync.get("settings", (result) => {
        defaultGroup.current.created = new Date(Date.now()).toString();
        defaultGroup.current.color = result.settings.color;
        defaultGroup.current.title = result.settings.title;
        current_groups["group-" + num_keys] = defaultGroup.current;
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
    // clear all the groups (easiest by wiping sync and restoring the settings)
    chrome.storage.sync.get("settings", (result) => {
      chrome.storage.sync.clear(() => {
        defaultGroup.current.created = new Date(Date.now()).toString();
        chrome.storage.sync.set(
          {
            "group-0": defaultGroup.current,
            settings: result.settings,
          },
          () => {
            setTabTotal(0);
            setGroups(JSON.stringify({ "group-0": defaultGroup.current }));
          }
        );
      });
    });
  }

  function toggleDarkMode(e) {
    var container = document.querySelector("body");
    var hr = document.querySelector("hr");
    var settings_btn = document.getElementById("options-btn");

    var isChecked = e.target.checked;
    container.style.background = isChecked ? "rgb(52, 58, 64)" : "white";
    container.style.color = isChecked ? "white" : "black";
    hr.style.borderTop = isChecked
      ? "1px white solid"
      : "1px rgba(0,0,0,.1) solid";
    settings_btn.style.border = isChecked
      ? "1px gray solid"
      : "1px black solid";

    chrome.storage.sync.get("settings", (result) => {
      result.settings.dark = isChecked === true;
      chrome.storage.sync.set({ settings: result.settings });
    });
  }

  function tabFilter(e) {
    var tabs = document.querySelectorAll(".draggable > a");

    var tab_titles = [...tabs].map((item) => item.innerText.toLowerCase());
    tab_titles.forEach((x, index) => {
      var title_match = x.indexOf(e.target.value.toLowerCase()) === -1;
      tabs[index].parentNode.style.display = title_match ? "none" : "";
    });
  }

  function groupFilter(e) {
    var group_section = document.querySelectorAll("div[editext='view']");

    var group_titles = [...group_section].map((x) => x.innerText.toLowerCase());
    group_titles.forEach((x, i) => {
      var parent = group_section[i].closest(".group-title").parentNode;
      var title_in_filter = x.indexOf(e.target.value.toLowerCase()) === -1;
      parent.style.display = title_in_filter ? "none" : "";
    });
  }

  function readImportedFile(e) {
    if (e.target.files[0].type === "application/json") {
      chrome.storage.sync.clear(() => {
        var reader = new FileReader();
        reader.readAsText(e.target.files[0]);
        reader.onload = () => {
          var fileContent = JSON.parse(reader.result);
          Object.keys(fileContent).forEach((key) => {
            updateGroupItem(key, fileContent[key]);
          });

          delete fileContent.settings;
          setGroups(JSON.stringify(fileContent));

          var sum = 0;
          Object.values(fileContent).forEach((val) => {
            sum += val.tabs.length;
          });

          setTabTotal(sum);
        };
      });
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

    chrome.storage.sync.get(null, (result) => {
      var dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(result, null, 2));

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

    chrome.storage.sync.get(null, (result) => {
      delete result.settings;

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
              tab.title.length > 75
                ? tab.title.substr(0, 75) + "..."
                : tab.title;

            doc.textWithLink(
              cleanString(title),
              index < 9 ? x + 11 : x + 13,
              y,
              { url: tab.url }
            );
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
    });
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
    } else if (isChrome || isOpera) {
      link =
        "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc";
    } else if (isFirefox) {
      link = "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger";
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
      <div className="row m-auto">
        <div className="col-lg-8" id="tabmerger-container">
          <div>
            <div className="custom-control custom-switch mt-4 float-right">
              <input
                type="checkbox"
                className="custom-control-input"
                id="darkMode"
                onChange={(e) => {
                  toggleDarkMode(e);
                }}
              />
              <label className="custom-control-label" for="darkMode">
                <b>{translate("darkMode")}</b>
              </label>
            </div>
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

              <div className="search-filter row float-right">
                <input
                  type="text"
                  name="search-group"
                  className="mr-2 px-1"
                  placeholder={translate("groupTitle")}
                  onChange={(e) => groupFilter(e)}
                />
                <input
                  type="text"
                  name="search-tab"
                  className="px-1"
                  placeholder={translate("tabTitle")}
                  onChange={(e) => tabFilter(e)}
                />
              </div>
            </div>
            <hr />
          </div>
          <div className="left-side-container">
            <div className="global-btn-row row">
              <Button
                id="open-all-btn"
                classes="ml-3 p-0 btn-in-global btn-outline-success"
                translate={translate("openAll")}
                tooltip={"tiptext-global"}
                onClick={() => openAllTabs()}
              >
                <FaTrashRestore color="green" />
              </Button>

              <Button
                id="delete-all-btn"
                classes="ml-1 mr-4 p-0 btn-in-global btn-outline-danger"
                translate={translate("deleteAll")}
                tooltip={"tiptext-global"}
                onClick={() => deleteAllGroups()}
              >
                <MdDeleteForever color="red" />
              </Button>

              <Button
                id="export-btn"
                classes="ml-4 btn-in-global btn-outline-info"
                translate={translate("exportJSON")}
                tooltip={"tiptext-global"}
                onClick={exportJSON}
              >
                <FaFileExport color="darkcyan" size="1.5rem" />
              </Button>

              <div>
                <label
                  id="import-btn"
                  for="import-input"
                  className="mx-1 my-0 btn-in-global btn btn-outline-info"
                >
                  <div className="tip">
                    <FaFileImport color="darkcyan" size="1.4rem" />
                    <span className="tiptext-global">
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
                classes="p-0 btn-in-global btn-outline-info"
                translate={translate("exportPDF")}
                tooltip={"tiptext-global"}
                onClick={() => exportPDF()}
              >
                <FaFilePdf color="purple" size="1.5rem" />
              </Button>

              <Button
                id="options-btn"
                classes="p-0 btn-in-global btn-outline-dark"
                translate={translate("settings")}
                tooltip={"tiptext-global"}
                onClick={() => window.location.replace("/options.html")}
              >
                <MdSettings color="grey" size="1.6rem" />
              </Button>
            </div>
            <div className="groups-container">
              {groupFormation(groups)}

              <Button
                id="add-group-btn"
                classes="d-block btn-in-global mt-1 ml-3 p-2"
                translate={translate("addGroup")}
                tooltip={"tiptext-global"}
                onClick={() => addGroup()}
              >
                <MdAddCircle color="grey" size="2rem" />
              </Button>
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div class="d-flex flex-column align-items-center" id="side-panel">
            <a
              href="https://tabmerger.herokuapp.com/"
              className="btn btn-info font-weight-bold mb-3"
              id="need-help"
            >
              {translate("needHelp")}
            </a>
            <h4>
              <b>{translate("quickDemo")}</b>
            </h4>

            <iframe
              style={{ frameBorder: "0", width: "100%", height: "260px" }}
              src="https://www.youtube.com/embed/gx0dNUbwCn4?controls=1&hd=1&playlist=gx0dNUbwCn4"
              allowFullScreen="true"
              webkitallowfullscreen="true"
              mozallowfullscreen="true"
              title="TabMerger Quick Demo"
              id="video-demo"
            ></iframe>

            <div id="donate" className="my-3">
              <h4 className="mb-3 text-center">
                <b>{translate("supportUs")}</b>
              </h4>
              <form
                action="https://www.paypal.com/donate"
                method="post"
                target="_top"
              >
                <input
                  type="hidden"
                  name="hosted_button_id"
                  value="X3EYMX8CVA4SY"
                />
                <input
                  type="image"
                  src="./images/paypal-donate.png"
                  alt="Donate with PayPal button"
                  border="0"
                  name="submit"
                />
              </form>
            </div>

            <div id="review" className="mb-3">
              <h4 className="mb-1 text-center">
                <b>{translate("leaveReview")}</b>
              </h4>
              <a href={getTabMergerLink(true)}>
                <div className="row ml-1 px-1">
                  {[1, 2, 3, 4, 5].map(() => {
                    return <RiStarSFill color="goldenrod" size="2rem" />;
                  })}
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

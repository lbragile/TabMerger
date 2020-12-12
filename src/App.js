import React, { useState, useEffect, useRef } from "react";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import Tabs from "./Tabs.js";
import Group from "./Group.js";

import { MdSettings, MdDeleteForever, MdAddCircle } from "react-icons/md";
import {
  FaTrashRestore,
  FaFileImport,
  FaFileExport,
  FaFilePdf,
} from "react-icons/fa";
import { RiStarSFill } from "react-icons/ri";

import jsPDF from "jspdf";

export default function App() {
  const ITEM_STORAGE_LIMIT = useRef(8000);
  const SYNC_STORAGE_LIMIT = useRef(102000);

  const defaultColor = useRef("#dedede");
  const defaultTitle = useRef("Title");
  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState(null);

  useEffect(() => {
    // set dark mode if needed & assign default values to state variables
    chrome.storage.sync.get(null, (result) => {
      var json = { target: { checked: null } };
      var darkModeSwitch = document.getElementById("darkMode");
      darkModeSwitch.checked = result.settings.dark;
      json.target.checked = result.settings.dark;

      toggleDarkMode(json);

      // state variables
      defaultColor.current = result.settings.color;
      defaultTitle.current = result.settings.title;
      delete result.settings; // delete but do not update sync storage;

      var sum = 0;
      Object.keys(result).forEach((key) => (sum += result[key].tabs.length));

      setTabTotal(sum);
      setGroups(groupFormation(result));
    });
  }, []);

  const groupFormation = (group_items) => {
    return Object.values(group_items).map((x, i) => {
      var id = "group-" + i;
      return (
        <Group
          id={id}
          className="group"
          title={x.title}
          color={x.color}
          created={x.created}
          key={Math.random()}
          setGroups={setGroups}
          setTabTotal={setTabTotal}
          groupFormation={groupFormation}
        >
          <Tabs
            itemLimit={ITEM_STORAGE_LIMIT.current}
            setTabTotal={setTabTotal}
            id={id}
            setGroups={setGroups}
            groupFormation={groupFormation}
          />
        </Group>
      );
    });
  };

  useEffect(() => {
    const removeTabs = (changes, namespace) => {
      if (namespace === "local" && changes.remove && changes.remove.newValue) {
        // try to not open tabs if it is already open
        chrome.tabs.query({ currentWindow: true }, async (windowTabs) => {
          for (var i = 0; i < changes.remove.newValue.length; i++) {
            var tab_url = changes.remove.newValue[i];
            var same_tab = windowTabs.filter((x) => x.url === tab_url);
            if (same_tab[0]) {
              chrome.tabs.move(same_tab[0].id, { index: -1 });
            } else {
              chrome.tabs.create({ url: tab_url, active: false });
            }

            // remove tab if needed
            await new Promise((resolve) => {
              chrome.storage.sync.get("settings", (result) => {
                if (result.settings.restore !== "keep") {
                  var elem = document.querySelector(
                    `.draggable a[href='${tab_url}']`
                  );

                  // click on the x button for this tab
                  elem.parentNode.querySelector(".close-tab").click();
                }
                resolve(0);
              });
            });
          }
        });
      }

      chrome.storage.local.remove("remove");
    };

    chrome.storage.onChanged.addListener(removeTabs);

    return () => {
      chrome.storage.onChanged.removeListener(removeTabs);
    };
  }, []);

  useEffect(() => {
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
          chrome.storage.sync.getBytesInUse(null, (syncBytesInUse) => {
            var sync_bytes =
              syncBytesInUse + JSON.stringify(merged_tabs).length;

            console.log(sync_bytes, "sync bytes");
            if (sync_bytes < SYNC_STORAGE_LIMIT.current) {
              chrome.storage.sync.getBytesInUse(
                into_group,
                (itemBytesInUse) => {
                  var item_bytes =
                    itemBytesInUse + JSON.stringify(merged_tabs).length;

                  console.log(item_bytes, into_group + " bytes");
                  if (item_bytes < ITEM_STORAGE_LIMIT.current) {
                    // close tabs to avoid leaving some open
                    chrome.tabs.remove(merged_tabs.map((x) => x.id));

                    chrome.storage.sync.get(null, (sync) => {
                      delete sync.settings;

                      var tabs_arr = [...sync[into_group].tabs, ...merged_tabs];
                      tabs_arr = tabs_arr.map((item) => ({
                        url: item.url,
                        favIconUrl: item.favIconUrl,
                        title: item.title,
                      }));

                      var current = document.querySelectorAll(".draggable");
                      setTabTotal(current.length + merged_tabs.length);

                      sync[into_group].tabs = tabs_arr;
                      updateGroupItem(into_group, sync[into_group]);
                      setGroups(groupFormation(sync));
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
                }
              );
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
    };

    chrome.storage.onChanged.addListener(checkMerging);

    return () => {
      chrome.storage.onChanged.removeListener(checkMerging);
    };
  }, []);

  // https://stackoverflow.com/a/5624139/4298115
  function rgb2hex(input) {
    var rgb = input.substr(4).replace(")", "").split(",");
    var hex = rgb.map((elem) => {
      let hex_temp = parseInt(elem).toString(16);
      return hex_temp.length === 1 ? "0" + hex_temp : hex_temp;
    });

    return "#" + hex.join("");
  }

  function updateGroupItem(name, value) {
    var storage_entry = {};
    storage_entry[name] = value;
    chrome.storage.sync.set(storage_entry, () => {});
  }

  useEffect(() => {
    // once a group is added: for each group, store the title, background color, and tab information
    setTimeout(() => {
      var group_blocks = document.querySelectorAll(".group");
      var ls_entry = {};
      for (let i = 0; i < group_blocks.length; i++) {
        ls_entry[group_blocks[i].id] = {
          title: group_blocks[i].parentNode.querySelector("div[editext='view']")
            .innerText,
          color: rgb2hex(group_blocks[i].style.background),
          created: group_blocks[i].parentNode.querySelector(".created")
            .lastChild.innerText,
          tabs: [],
        };

        var group_tabs = group_blocks[i].querySelectorAll(".draggable");
        var tabs_entry = [...group_tabs].map((x) => ({
          favIconUrl: x.querySelector("img").src,
          url: x.querySelector("a").href,
          title: x.querySelector("a").innerText,
        }));

        ls_entry[group_blocks[i].id].tabs = tabs_entry;
      }

      Object.keys(ls_entry).forEach((key) => {
        updateGroupItem(key, ls_entry[key]);
      });
    }, 10);
  }, [groups]);

  const addGroup = () => {
    setGroups([
      ...groups,
      <Group
        id={"group-" + groups.length}
        className="group"
        color={defaultColor.current}
        title={defaultTitle.current}
        created={new Date(Date.now()).toString()}
        key={Math.random()}
        setGroups={setGroups}
        setTabTotal={setTabTotal}
        groupFormation={groupFormation}
      >
        <Tabs
          itemLimit={ITEM_STORAGE_LIMIT.current}
          setTabTotal={setTabTotal}
          id={"group-" + groups.length}
          setGroups={setGroups}
          groupFormation={groupFormation}
        />
      </Group>,
    ]);
  };

  async function openAllTabs() {
    var tab_links = [...document.querySelectorAll(".a-tab")].map((x) => x.href);
    chrome.storage.local.set({ remove: tab_links });
  }

  function deleteAllGroups() {
    var default_group = {
      title: defaultTitle.current,
      color: defaultColor.current,
      created: new Date(Date.now()).toString(),
      tabs: [],
    };

    // clear all the groups (easiest by wiping sync and restoring the settings)
    chrome.storage.sync.get("settings", (result) => {
      chrome.storage.sync.clear(() => {
        chrome.storage.sync.set(
          {
            "group-0": default_group,
            settings: result.settings,
          },
          () => {
            setTabTotal(0);
            setGroups(groupFormation({ "group-0": default_group }));
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
          setGroups(groupFormation(fileContent));
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
        encodeURIComponent(JSON.stringify(result));

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

  async function exportPDF() {
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

    var group_blocks = await new Promise((resolve) => {
      chrome.storage.sync.get(null, (result) => {
        delete result.settings;
        resolve(result);
      });
    });

    Object.values(group_blocks).forEach((item) => {
      // rectangle around the group
      doc.setFillColor(item.color);

      var group_height =
        item.tabs.length > 0
          ? 10 * (item.tabs.length + 1)
          : 10 * (item.tabs.length + 2);
      doc.roundedRect(x - 5, y + 8, 175, group_height, 1, 1, "F");

      y += 15;
      if (y >= height) {
        doc.addPage();
        y = 25;
      }
      doc.setTextColor("000");
      doc.setFontSize(16);
      doc.text(item.title, x - 3, y);

      doc.setFontSize(12);

      // if tabs in the group exist
      if (item.tabs.length > 0) {
        item.tabs.forEach((tab, index) => {
          y += 10;
          if (y >= height) {
            doc.addPage();
            y = 25;
          }
          doc.setTextColor("#000");
          doc.text(index + 1 + ".", x + 5, y);
          doc.setTextColor(51, 153, 255);

          var title =
            tab.title.length > 75 ? tab.title.substr(0, 75) + "..." : tab.title;
          //prettier-ignore
          doc.textWithLink(cleanString(title), index < 9 ? x + 11 : x + 13, y, { url: tab.url });
        });
      } else {
        doc.setTextColor("#000");
        doc.text("[ NO TABS IN GROUP ]", x + 5, y + 10);
        y += 10;
      }
    });

    // page numbers
    doc.setTextColor("000");
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
            <a
              href={
                /chrome/i.test(navigator.userAgent)
                  ? "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc"
                  : "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger"
              }
            >
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
                <div>
                  <label
                    for="search-group"
                    className="d-block mb-0 font-weight-bold"
                  >
                    {translate("groupTitle")}:{" "}
                  </label>
                  <input
                    type="text"
                    name="search-group"
                    className="mr-2 px-1"
                    onChange={(e) => groupFilter(e)}
                  />
                </div>
                <div>
                  <label
                    for="search-tab"
                    className="d-block mb-0 font-weight-bold"
                  >
                    {translate("tabTitle")}:{" "}
                  </label>
                  <input
                    type="text"
                    name="search-tab"
                    className="px-1"
                    onChange={(e) => tabFilter(e)}
                  />
                </div>
              </div>
            </div>
            <hr />
          </div>
          <div className="left-side-container">
            <div className="global-btn row">
              <button
                id="open-all-btn"
                className="ml-3 p-0 btn btn-outline-success"
                type="button"
                onClick={() => openAllTabs()}
                style={{ width: "45px", height: "45px" }}
              >
                <div className="tip">
                  <FaTrashRestore
                    color="green"
                    style={{ width: "22px", height: "22px", padding: "0" }}
                  />
                  <span className="tiptext">{translate("openAll")}</span>
                </div>
              </button>
              <button
                id="delete-all-btn"
                className="ml-1 mr-4 p-0 btn btn-outline-danger"
                type="button"
                onClick={() => deleteAllGroups()}
                style={{ width: "45px", height: "45px" }}
              >
                <div className="tip">
                  <MdDeleteForever
                    color="red"
                    style={{
                      width: "30px",
                      height: "35px",
                      padding: "0",
                      paddingTop: "4px",
                    }}
                  />
                  <span className="tiptext">{translate("deleteAll")}</span>
                </div>
              </button>

              <button
                id="export-btn"
                className="ml-4 btn btn-outline-info"
                style={{
                  width: "45px",
                  height: "45px",
                }}
                type="button"
                onClick={exportJSON}
              >
                <div className="tip">
                  <FaFileExport
                    color="darkcyan"
                    size="1.5rem"
                    style={{
                      position: "relative",
                      top: "2px",
                    }}
                  />
                  <span className="tiptext">{translate("exportJSON")}</span>
                </div>
              </button>

              <div>
                <label
                  id="import-btn"
                  for="import-input"
                  className="mx-1 my-0 btn btn-outline-info"
                  style={{
                    width: "45px",
                    height: "45px",
                  }}
                >
                  <div className="tip">
                    <FaFileImport
                      color="darkcyan"
                      size="1.4rem"
                      style={{
                        position: "relative",
                        top: "3px",
                      }}
                    />
                    <span className="tiptext">{translate("importJSON")}</span>
                  </div>
                </label>
                <input
                  id="import-input"
                  type="file"
                  accept=".json"
                  onChange={(e) => readImportedFile(e)}
                ></input>
              </div>

              <button
                id="pdf-btn"
                className="p-0 btn btn-outline-info"
                type="button"
                onClick={() => exportPDF()}
                style={{ width: "45px", height: "45px" }}
              >
                <div className="tip">
                  <FaFilePdf color="purple" size="1.5rem" />
                  <span className="tiptext">{translate("exportPDF")}</span>
                </div>
              </button>
              <button
                id="options-btn"
                className="p-0 btn btn-outline-dark"
                type="button"
                onClick={() =>
                  window.location.replace(chrome.runtime.getURL("options.html"))
                }
                style={{ width: "45px", height: "45px" }}
              >
                <div className="tip">
                  <MdSettings color="grey" size="1.6rem" />
                  <span className="tiptext">{translate("settings")}</span>
                </div>
              </button>
            </div>

            <div className="groups-container">
              {groups}

              <button
                className="d-block mt-1 ml-3 p-2 btn"
                id="add-group-btn"
                type="button"
                onClick={() => addGroup()}
              >
                <div className="tip">
                  <MdAddCircle color="grey" size="2rem" />
                  <span className="tiptext">{translate("addGroup")}</span>
                </div>
              </button>
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
              <a
                href={
                  /chrome/i.test(navigator.userAgent)
                    ? "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/reviews"
                    : "https://addons.mozilla.org/en-CA/firefox/addon/tabmerger/reviews/"
                }
              >
                <div className="row ml-1 px-1">
                  <RiStarSFill color="goldenrod" size="2rem" />
                  <RiStarSFill color="goldenrod" size="2rem" />
                  <RiStarSFill color="goldenrod" size="2rem" />
                  <RiStarSFill color="goldenrod" size="2rem" />
                  <RiStarSFill color="goldenrod" size="2rem" />
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from "react";

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
  var settings = JSON.parse(window.localStorage.getItem("settings"));
  const defaultColor = useRef(settings.color);
  const defaultTitle = useRef(settings.title);

  const [tabTotal, setTabTotal] = useState(() => {
    var group_blocks = JSON.parse(window.localStorage.getItem("groups"));
    var sum = 0;
    Object.values(group_blocks).forEach((x) => (sum += x.tabs.length));
    return sum;
  });

  const groupFormation = (group_blocks) => {
    return group_blocks
      ? Object.values(group_blocks).map((x, index) => {
          return (
            <Group
              id={"group-" + index}
              className="group"
              title={x.title}
              color={x.color}
              created={x.created}
              key={Math.random()}
            >
              <Tabs setTabTotal={setTabTotal} id={"group-" + index} />
            </Group>
          );
        })
      : [
          <Group
            id="group-0"
            className="group"
            title={defaultTitle.current}
            color={defaultColor.current}
            created={new Date(Date.now()).toString()}
            key={Math.random()}
          >
            <Tabs setTabTotal={setTabTotal} id="group-0" />
          </Group>,
        ];
  };

  const [groups, setGroups] = useState(
    groupFormation(JSON.parse(window.localStorage.getItem("groups")))
  );

  // https://stackoverflow.com/a/5624139/4298115
  function rgb2hex(input) {
    var rgb = input.substr(4).replace(")", "").split(",");
    var hex = rgb.map((elem) => {
      let hex_temp = parseInt(elem).toString(16);
      return hex_temp.length === 1 ? "0" + hex_temp : hex_temp;
    });

    return "#" + hex.join("");
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

      window.localStorage.setItem("groups", JSON.stringify(ls_entry));
    }, 10);
  }, [groups]);

  useEffect(() => {
    // set dark mode if needed
    var json = { target: { checked: null } };
    var darkModeSwitch = document.getElementById("darkMode");
    var switchOn = JSON.parse(window.localStorage.getItem("settings")).dark;
    darkModeSwitch.checked = switchOn;
    json.target.checked = switchOn;

    toggleDarkMode(json);
  }, []);

  const addGroup = () => {
    setGroups([
      ...groups,
      <Group
        id={"group-" + groups.length}
        className="group"
        key={Math.random()}
        color={defaultColor.current}
        title={defaultTitle.current}
        created={new Date(Date.now()).toString()}
      >
        <Tabs setTabTotal={setTabTotal} id={"group-" + groups.length} />
      </Group>,
    ]);
  };

  function openAllTabs() {
    var tabs = document.querySelectorAll(".draggable");
    tabs.forEach((tab) => {
      tab.querySelector("a").click();
    });

    if (
      JSON.parse(window.localStorage.getItem("settings")).restore !== "keep"
    ) {
      document.querySelector("#delete-all-btn").click();
    }
  }

  function deleteAllGroups() {
    var default_group = JSON.stringify({
      "group-0": {
        title: defaultTitle.current,
        color: defaultColor.current,
        created: new Date(Date.now()).toString(),
        tabs: [],
      },
    });

    window.localStorage.setItem("groups", default_group);
    setTabTotal(0);
    setGroups([
      <Group
        id="group-0"
        className="group"
        title={defaultTitle.current}
        color={defaultColor.current}
        created={new Date(Date.now()).toString()}
        key={Math.random()}
      >
        <Tabs setTabTotal={setTabTotal} id="group-0" />
      </Group>,
    ]);
  }

  function toggleDarkMode(e) {
    var container = document.querySelector("body");
    var hr = document.querySelector("hr");
    var settings_btn = document.getElementById("options-btn");

    var settings = JSON.parse(window.localStorage.getItem("settings"));
    if (e.target.checked) {
      container.style.background = "#343a40";
      container.style.color = "white";
      hr.style.borderTop = "1px white solid";
      settings_btn.style.border = "1px gray solid";

      settings.dark = 1;
      window.localStorage.setItem("settings", JSON.stringify(settings));
    } else {
      container.style.background = "white";
      container.style.color = "black";
      hr.style.borderTop = "1px rgba(0,0,0,.1) solid";
      settings_btn.style.border = "1px black solid";

      settings.dark = 0;
      window.localStorage.setItem("settings", JSON.stringify(settings));
    }
  }

  function tabFilter(e) {
    var tabs = document.querySelectorAll(".draggable > a");

    var tab_titles = [...tabs].map((item) => item.innerText.toLowerCase());
    tab_titles.forEach((item, index) => {
      if (item.indexOf(e.target.value.toLowerCase()) === -1) {
        tabs[index].parentNode.style.display = "none";
      } else {
        tabs[index].parentNode.style.display = "";
      }
    });
  }

  function groupFilter(e) {
    var groups = JSON.parse(window.localStorage.getItem("groups"));
    var group_titles = Object.values(groups).map((item) =>
      item.title.toLowerCase()
    );
    group_titles.forEach((item, index) => {
      if (item.indexOf(e.target.value.toLowerCase()) === -1) {
        // prettier-ignore
        document.querySelector("#group-" + index).parentNode.style.display = "none";
      } else {
        document.querySelector("#group-" + index).parentNode.style.display = "";
      }
    });
  }

  function readImportedFile(e) {
    if (e.target.files[0].type === "application/json") {
      var reader = new FileReader();
      reader.readAsText(e.target.files[0]);
      reader.onload = () => {
        var fileContent = JSON.parse(reader.result);
        window.localStorage.setItem("groups", fileContent.groups);
        window.localStorage.setItem("settings", fileContent.settings);
        window.location.reload();
      };
    } else {
      alert(
        'You must import a JSON file (.json extension)!\nThese can be generated via the "Export JSON" button.'
      );
    }
  }

  const exportJSON = () => {
    setGroups(groups);

    var dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(
        JSON.stringify({
          groups: window.localStorage.getItem("groups"),
          settings: window.localStorage.getItem("settings"),
        })
      );

    var anchor = document.getElementById("export-btn");
    anchor.setAttribute("href", dataStr);
    anchor.setAttribute("download", outputFileName() + ".json");
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

  function exportPDF() {
    var doc = new jsPDF();

    var group_blocks = JSON.parse(window.localStorage.getItem("groups"));

    var { width, height } = doc.internal.pageSize;
    // prettier-ignore
    var x = 25, y = 50;

    doc.addImage(
      "./images/logo-full-rescale.PNG",
      "PNG",
      x - 5,
      y - 25,
      74.4,
      14
    );
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
    doc.addImage("./images/logo16.png", "PNG", width - 20, y - 20, 5, 5);

    doc.setFontSize(16);
    doc.setTextColor("000");
    doc.text(tabTotal + " tabs in total", x - 5, y);

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

          var favIcon = tab.favIconUrl;
          if (favIcon.includes(".ico")) {
            favIcon = "./images/logo16.png";
          }
          var title =
            tab.title.length > 75 ? tab.title.substr(0, 75) + "..." : tab.title;
          doc.addImage(favIcon, x + 11, y - 4, 5, 5);

          //prettier-ignore
          doc.textWithLink(cleanString(title), x + 18, y, { url: tab.url });
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

              <a
                id="export-btn"
                className="ml-4 btn btn-outline-info"
                style={{
                  width: "45px",
                  height: "45px",
                }}
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
              </a>

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

        <div className="col-lg-4 float-right my-auto">
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

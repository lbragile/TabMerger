import React, { useState, useEffect, useRef } from "react";

import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";
import Tabs from "./Tabs.js";
import Group from "./Group.js";

import {
  MdSettings,
  MdDeleteForever,
  MdVerticalAlignCenter,
  MdAddCircle,
} from "react-icons/md";
import { FaTrashRestore } from "react-icons/fa";
import { BiArrowToRight } from "react-icons/bi";
import { FiShare } from "react-icons/fi";
import { RiStarSFill } from "react-icons/ri";

import { nanoid } from "nanoid";
import axios from "axios";

export default function App() {
  const defaultColor = useRef(
    (JSON.parse(window.localStorage.getItem("settings")) &&
      JSON.parse(window.localStorage.getItem("settings")).color) ||
      "#DEDEDE"
  );
  const defaultTitle = useRef(
    (JSON.parse(window.localStorage.getItem("settings")) &&
      JSON.parse(window.localStorage.getItem("settings")).title) ||
      "Title"
  );

  const [tabTotal, setTabTotal] = useState(0);
  const [groups, setGroups] = useState(() => {
    var group_blocks = JSON.parse(window.localStorage.getItem("groups"));
    return group_blocks
      ? Object.keys(group_blocks).map((item) => {
          return (
            <Group
              id={item}
              className="group"
              title={group_blocks[item].title}
              color={group_blocks[item].color}
              created={group_blocks[item].created}
              key={Math.random()}
            >
              <Tabs setTabTotal={setTabTotal} id={item} />
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
  });

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
    var group_blocks = document.querySelectorAll(".group");
    var ls_entry = {};
    for (let i = 0; i < group_blocks.length; i++) {
      ls_entry[group_blocks[i].id] = {
        title: group_blocks[i].parentNode.querySelector("div[editext='view']")
          .innerText,
        color: rgb2hex(group_blocks[i].style.background),
        created: group_blocks[i].parentNode.querySelector(".created").lastChild
          .innerText,
        tabs: [],
      };

      var group_tabs = group_blocks[i].querySelectorAll(
        "div[draggable='true']"
      );

      var tabs_entry = [];
      for (let j = 0; j < group_tabs.length; j++) {
        tabs_entry.push({
          favIconUrl: group_tabs[j].querySelector("img").src,
          url: group_tabs[j].querySelector("a").href,
          title: group_tabs[j].querySelector("a").innerText,
        });
      }

      ls_entry[group_blocks[i].id].tabs = tabs_entry;
    }

    window.localStorage.setItem("groups", JSON.stringify(ls_entry));
    if (!window.localStorage.getItem("settings")) {
      window.localStorage.setItem(
        "settings",
        JSON.stringify({
          color: "#dedede",
          title: "Title",
          restore: "keep",
          blacklist: "",
        })
      );
    }
  }, [groups]);

  useEffect(() => {
    // for shared links
    const query = window.location.search;
    const urlParams = new URLSearchParams(query);
    const ext_url = chrome
      ? chrome.runtime.getURL("index.html")
      : browser.runtime.getURL("index.html");
    if (urlParams && window.location.href !== ext_url) {
      window.localStorage.setItem("groups", urlParams.get("ls"));
      window.location.replace(ext_url);
    }

    // set dark mode if needed
    var json = { target: { checked: null } };
    var darkModeSwitch = document.getElementById("darkMode");
    var switchOn = window.localStorage.getItem("dark") === "true";
    darkModeSwitch.checked = switchOn;
    json.target.checked = switchOn;

    toggleDarkMode(json);
  }, []);

  function sendMessage(msg) {
    var extension_id = chrome ? chrome.runtime.id : browser.runtime.id;
    chrome
      ? chrome.runtime.sendMessage(extension_id, msg)
      : browser.runtime.sendMessage(extension_id, msg);
  }

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
    window.localStorage.setItem(
      "groups",
      JSON.stringify({
        "group-0": {
          title: defaultTitle.current,
          color: defaultColor.current,
          created: new Date(Date.now()).toString(),
          tabs: [],
        },
      })
    );

    window.location.reload();
  }

  async function shareAllGroups(e) {
    var group_blocks = window.localStorage.getItem("groups");
    var id_extra = /chrome/i.test(navigator.userAgent) ? "-c" : "-f";
    var unique_id = nanoid(13) + id_extra;
    var response = await axios.post(
      "https://tabmerger.herokuapp.com/shortenURL/",
      {
        groups: group_blocks.toString(),
        id: unique_id,
      }
    );
    if (response.data.success) {
      e.target
        .closest("button")
        .nextSibling.append(
          "https://tabmerger.herokuapp.com/sharedURL/" + unique_id
        );
    } else {
      alert("Failed to generate shareable link. Please try again");
    }
  }

  function copyLinkOnFocus(e) {
    var text = selectElementContents(e.target);
    document.execCommand("copy");
    alert(
      `We copied the following link to your clipboard:\n\n${text}\n\nYou can now share it with anyone.`
    );
  }

  // https://stackoverflow.com/questions/6139107/programmatically-select-text-in-a-contenteditable-html-element
  function selectElementContents(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return sel;
  }

  function toggleDarkMode(e) {
    var container = document.querySelector("body");
    var hr = document.querySelector("hr");
    var settings_btn = document.getElementById("options-btn");

    if (e.target.checked) {
      container.style.background = "#343a40";
      container.style.color = "white";
      hr.style.borderTop = "1px white solid";
      settings_btn.style.border = "1px gray solid";
      window.localStorage.setItem("dark", "true");
    } else {
      container.style.background = "white";
      container.style.color = "black";
      hr.style.borderTop = "1px rgba(0,0,0,.1) solid";
      settings_btn.style.border = "1px black solid";
      window.localStorage.removeItem("dark");
    }
  }

  function translate(msg) {
    return chrome ? chrome.i18n.getMessage(msg) : browser.i18n.getMessage(msg);
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
                <b>Dark Mode</b>
              </label>
            </div>
            <a href="https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc">
              <img
                id="logo-img"
                className="mt-4"
                src="./images/logo-full-rescale.PNG"
                alt="TabMerger Logo"
              />
            </a>
            <h2 id="tab-total">
              <span className="small">
                {tabTotal}{" "}
                {tabTotal == 1
                  ? translate("pageTotalSingular")
                  : translate("pageTotalPlural")}
              </span>
            </h2>
            <hr />
          </div>

          <div className="row">
            <button
              id="merge-btn"
              className="ml-3 p-0 btn btn-outline-primary"
              type="button"
              onClick={() => sendMessage({ msg: "all" })}
              style={{ width: "45px", height: "45px" }}
            >
              <div className="tip">
                <MdVerticalAlignCenter
                  style={{ transform: "rotate(90deg)" }}
                  color="black"
                  size="1.6rem"
                />
                <span className="tiptext">{translate("mergeALLtabs")}</span>
              </div>
            </button>
            <button
              id="merge-left-btn"
              className="ml-1 p-0 btn btn-outline-warning"
              type="button"
              onClick={() => sendMessage({ msg: "left" })}
              style={{ width: "45px", height: "45px" }}
            >
              <div className="tip">
                <BiArrowToRight color="black" size="1.3rem" />
                <span className="tiptext">{translate("mergeLEFTtabs")}</span>
              </div>
            </button>
            <button
              id="merge-right-btn"
              className="ml-1 mr-4 p-0 btn btn-outline-warning"
              type="button"
              onClick={() => sendMessage({ msg: "right" })}
              style={{ width: "45px", height: "45px" }}
            >
              <div className="tip">
                <BiArrowToRight
                  style={{ transform: "rotate(180deg)" }}
                  color="black"
                  size="1.3rem"
                />
                <span className="tiptext">{translate("mergeRIGHTtabs")}</span>
              </div>
            </button>
            <button
              id="open-all-btn"
              className="ml-4 p-0 btn btn-outline-success"
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

            <div className="d-flex flex-row align-items-center">
              <button
                id="share-all-btn"
                className="ml-4 p-0 btn btn-outline-info"
                type="button"
                onClick={(e) => shareAllGroups(e)}
                style={{ width: "45px", height: "45px" }}
              >
                <div className="tip">
                  <FiShare color="darkcyan" size="1.4rem" />
                  <span className="tiptext">{translate("shareAll")}</span>
                </div>
              </button>
              <div
                className="ml-1"
                id="short-url"
                contentEditable
                onClick={(e) => copyLinkOnFocus(e)}
              ></div>
            </div>
            <button
              id="options-btn"
              className="mr-3 p-0 btn btn-outline-dark"
              type="button"
              onClick={() =>
                window.location.replace(
                  chrome
                    ? chrome.runtime.getURL("options.html")
                    : browser.runtime.getURL("options.html")
                )
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
              className="d-block mt-2 ml-3 p-2 btn"
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
              style={{ frameBorder: "0", width: "100%", height: "270px" }}
              src="https://www.youtube.com/embed/cXG1lIx7WP4?controls=1&hd=1&playlist=cXG1lIx7WP4"
              allowFullScreen
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
                  border="0"
                  name="submit"
                />
              </form>
            </div>

            <div id="review" className="mb-3">
              <h4 className="mb-1 text-center">
                <b>{translate("leaveReview")}</b>
              </h4>
              <a href="https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/reviews">
                <div className="row mx-0 px-1">
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

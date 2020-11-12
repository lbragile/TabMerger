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
    if (
      urlParams &&
      window.location.href !== chrome.runtime.getURL("index.html")
    ) {
      window.localStorage.setItem("groups", urlParams.get("ls"));
      window.location.replace(chrome.runtime.getURL("index.html"));
    }
  }, []);

  function sendMessage(msg) {
    var extension_id = chrome.runtime
      .getURL("index.html")
      .replace("chrome-extension://", "")
      .replace("/index.html", "");
    chrome.runtime.sendMessage(extension_id, msg);
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
    var unique_id = nanoid(15);
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

  return (
    <>
      <div className="container">
        <div>
          <img
            id="logo-img"
            className="mt-2"
            src="./images/logo-full-rescale.PNG"
            alt="TabMerger Logo"
          />
          <h2 id="tab-total">
            <span className="small">{tabTotal} tabs in total</span>
          </h2>
          <hr />
        </div>

        <div className="row">
          <button
            id="merge-btn"
            className="ml-3 py-1 px-2 btn btn-outline-primary"
            type="button"
            onClick={() => sendMessage({ msg: "all" })}
          >
            <div className="tip">
              <MdVerticalAlignCenter
                style={{ transform: "rotate(90deg)" }}
                color="black"
                size="1.6rem"
              />
              <span className="tiptext">Merge ALL Tabs</span>
            </div>
          </button>
          <button
            id="merge-left-btn"
            className="ml-1 py-1 px-2 btn btn-outline-warning"
            type="button"
            onClick={() => sendMessage({ msg: "left" })}
          >
            <div className="tip">
              <BiArrowToRight color="black" size="1.3rem" />
              <span className="tiptext">Merge LEFT Tabs</span>
            </div>
          </button>
          <button
            id="merge-right-btn"
            className="ml-1 mr-4 py-1 px-2 btn btn-outline-warning"
            type="button"
            onClick={() => sendMessage({ msg: "right" })}
          >
            <div className="tip">
              <BiArrowToRight
                style={{ transform: "rotate(180deg)" }}
                color="black"
                size="1.3rem"
              />
              <span className="tiptext">Merge RIGHT Tabs</span>
            </div>
          </button>
          <button
            id="open-all-btn"
            className="ml-4 py-1 px-2 btn btn-outline-success"
            type="button"
            onClick={() => openAllTabs()}
          >
            <div className="tip">
              <FaTrashRestore color="green" size="1.3rem" />
              <span className="tiptext">Open All</span>
            </div>
          </button>
          <button
            id="delete-all-btn"
            className="ml-1 mr-4 p-1 btn btn-outline-danger"
            type="button"
            onClick={() => deleteAllGroups()}
          >
            <div className="tip">
              <MdDeleteForever color="red" size="1.7rem" />
              <span className="tiptext">Delete All</span>
            </div>
          </button>

          <div className="d-flex flex-row align-items-center">
            <button
              id="share-all-btn"
              className="ml-4 p-1 btn btn-outline-info"
              type="button"
              onClick={(e) => shareAllGroups(e)}
            >
              <div className="tip">
                <FiShare color="darkcyan" size="1.4rem" />
                <span className="tiptext">Share All</span>
              </div>
            </button>
            <div
              className="ml-1 py-1 px-2"
              id="short-url"
              contentEditable
              onClick={(e) => {
                copyLinkOnFocus(e);
              }}
            ></div>
          </div>
          <button
            id="options-btn"
            className="mr-3 py-1 px-2 btn btn-outline-dark"
            type="button"
            onClick={() =>
              window.location.replace(chrome.runtime.getURL("options.html"))
            }
          >
            <div className="tip">
              <MdSettings color="grey" size="1.6rem" />
              <span className="tiptext">Settings</span>
            </div>
          </button>
        </div>

        <div className="groups-container">
          {groups}

          <button
            className="d-block mt-2 btn"
            id="add-group-btn"
            type="button"
            onClick={() => addGroup()}
          >
            <div className="tip">
              <MdAddCircle color="grey" size="2rem" />
              <span className="tiptext">Add Group</span>
            </div>
          </button>
        </div>
      </div>

      <div id="donate" className="mb-2">
        <form
          action="https://www.paypal.com/donate"
          method="post"
          target="_top"
        >
          <input type="hidden" name="hosted_button_id" value="X3EYMX8CVA4SY" />
          <input
            type="image"
            src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif"
            border="0"
            name="submit"
            alt="Donate with PayPal button"
          />
        </form>
      </div>

      {/* <div id="copyright" className="mb-2">
        <b>&#169; Lior Bragilevsky, 2020</b>
      </div> */}
    </>
  );
}

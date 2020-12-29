import React from "react";
import { render, fireEvent } from "@testing-library/react";

import * as TabFunc from "../src/Tab/Tab_functions";

import Tab from "../src/Tab/Tab";

var init_groups = {
  "group-0": {
    color: "#d6ffe0",
    created: "11/12/2020 @ 22:13:24",
    tabs: [
      {
        title:
          "Stack Overflow - Where Developers Learn, Share, & Build Careersaaaaaaaaaaaaaaaaaaaaaa",
        url: "https://stackoverflow.com/",
      },
      {
        title: "lichess.org • Free Online Chess",
        url: "https://lichess.org/",
      },
      {
        title: "Chess.com - Play Chess Online - Free Games",
        url: "https://www.chess.com/",
      },
    ],
    title: "Chess",
  },
  "group-1": {
    color: "#c7eeff",
    created: "11/12/2020 @ 22:15:11",
    tabs: [
      {
        title: "Twitch",
        url: "https://www.twitch.tv/",
      },
      {
        title: "reddit: the front page of the internet",
        url: "https://www.reddit.com/",
      },
    ],
    title: "Social",
  },
};

describe("setInitTabs", () => {
  describe("Initialize correct number of tabs", () => {
    it("works when not empty", () => {
      var tabs = init_groups["group-0"].tabs;
      const { container } = render(<Tab init_tabs={tabs} />);
      expect(container.getElementsByClassName("draggable").length).toEqual(3);
    });

    it("works when empty", () => {
      const { container } = render(<Tab />);
      expect(container.getElementsByClassName("draggable").length).toEqual(0);
    });
  });

  describe("Title Shortening", () => {
    it("shortens the title if above the limit and adds ...", () => {
      var tabs = init_groups["group-0"].tabs;
      const { container } = render(<Tab init_tabs={tabs} />);
      var received_text = container.querySelector("a > span").textContent;
      expect(received_text.length).toEqual(83);
      expect(received_text).toBe(
        "Stack Overflow - Where Developers Learn, Share, & Build Careersaaaaaaaaaaaaaaaaa..."
      );
    });
  });
});

describe("removeTab", () => {
  it("correctly adjusts groups and counts when a tab is removed", () => {
    var tabs = init_groups["group-0"].tabs;
    const { container } = render(<Tab init_tabs={tabs} />);
    expect(container.getElementsByClassName("draggable").length).toEqual(3);

    var removeTabSpy = jest.spyOn(TabFunc, "removeTab");

    fireEvent.click(container.querySelector(".close-tab"));
    expect(removeTabSpy).toHaveBeenCalledTimes(1);
  });
});

describe("getFavIconURL", () => {
  it("returns the API call with just domain name", () => {
    var base = "http://www.google.com/s2/favicons?domain=";
    var url = "https://www.google.com/";
    var domain = "www.google.com";
    expect(TabFunc.getFavIconURL(url)).toBe(base + domain);
  });
});

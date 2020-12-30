import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react";

import * as AppFunc from "../src/App/App_functions";
import { init_groups } from "../__mocks__/variableMocks";

import App from "../src/App/App";

var init_ls_entry, init_tabs, mockSet, container;

beforeEach(() => {
  //   chrome.storage.local.set({ groups: init_groups }, () => {});
  //   init_ls_entry = JSON.parse(localStorage.getItem("groups"));
  //   init_tabs = init_ls_entry["group-0"].tabs;
  mockSet = jest.fn(); // mock for setState hooks
  container = render(<App />).container;
});

afterEach(() => {
  //   chrome.storage.local.clear();
  jest.clearAllMocks();
});

describe("translate", () => {
  it("returns a translation if avaiable", () => {
    expect(AppFunc.translate("Title")).toEqual("титул");
  });

  it("returns original msg if translation is not avaialbe", () => {
    expect(AppFunc.translate("random")).toEqual("random");
  });
});

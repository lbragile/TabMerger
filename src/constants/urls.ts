// TABMERGER
export const TABMERGER_REVIEWS =
  "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/reviews/";

export const TABMERGER_HELP = "https://groups.google.com/g/tabmerger";

export const TABMERGER_DEMO_SITE = "https://lbragile.github.io/TabMerger-Extension";

export const TABMERGER_TOS_LINK = TABMERGER_DEMO_SITE + "/terms";

export const TABMERGER_SURVEY = TABMERGER_DEMO_SITE + "/survey";

// EXTENSION
export const EXTENSION_PAGE_LINK = `chrome://extensions?id=${chrome.runtime.id}`;

export const DOWNLOADS_URL = "chrome://downloads";

// DEFAULT
export const DEFAULT_FAVICON_URL = "https://developer.chrome.com/images/meta/favicon-32x32.png";

export const GOOGLE_HOMEPAGE = "https://www.google.com";

// LICENSE
const GITHUB_BASE_URL = "https://github.com";

const TABMERGER_REPO = GITHUB_BASE_URL + "/lbragile/TabMerger";
const TABMERGER_LICENSE = TABMERGER_REPO + "/blob/master/LICENSE.md";

const REACT_BEAUTIFUL_DND_REPO = GITHUB_BASE_URL + "/atlassian/react-beautiful-dnd";
const REACT_BEAUTIFUL_DND_LICENSE = REACT_BEAUTIFUL_DND_REPO + "/blob/master/LICENSE";

const REACT_REPO = GITHUB_BASE_URL + "/facebook/react";
const REACT_LICENSE = REACT_REPO + "/blob/main/LICENSE";

const REDUX_REPO = GITHUB_BASE_URL + "/reduxjs/redux";
const REDUX_LICENSE = REDUX_REPO + "/blob/master/LICENSE.md";

const STYLED_COMPONENTS_REPO = GITHUB_BASE_URL + "/styled-components/styled-components";
const STYLED_COMPONENTS_LICENSE = STYLED_COMPONENTS_REPO + "/blob/main/LICENSE";

const FILE_SAVER_REPO = GITHUB_BASE_URL + "/eligrey/FileSaver.js";
const FILE_SAVER_LICENSE = FILE_SAVER_REPO + "/blob/master/LICENSE.md";

const NANOID_REPO = GITHUB_BASE_URL + "/ai/nanoid";
const NANOID_LICENSE = NANOID_REPO + "/blob/main/LICENSE";

export const LICENSE_INFO = {
  TabMerger: {
    repo: TABMERGER_REPO,
    license: TABMERGER_LICENSE
  },
  ReactBeautifulDnD: {
    repo: REACT_BEAUTIFUL_DND_REPO,
    license: REACT_BEAUTIFUL_DND_LICENSE
  },
  React: {
    repo: REACT_REPO,
    license: REACT_LICENSE
  },
  Redux: {
    repo: REDUX_REPO,
    license: REDUX_LICENSE
  },
  StyledComponents: {
    repo: STYLED_COMPONENTS_REPO,
    license: STYLED_COMPONENTS_LICENSE
  },
  FileSaver: {
    repo: FILE_SAVER_REPO,
    license: FILE_SAVER_LICENSE
  },
  NanoID: {
    repo: NANOID_REPO,
    license: NANOID_LICENSE
  }
};

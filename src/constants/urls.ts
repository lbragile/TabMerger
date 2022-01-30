// TABMERGER
export const TABMERGER_REVIEWS =
  "https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/reviews/";

export const TABMERGER_HELP = "https://groups.google.com/g/tabmerger";

export const TABMERGER_DEMO_SITE = "https://lbragile.github.io/TabMerger-Extension";

export const TABMERGER_TOS_LINK = TABMERGER_DEMO_SITE + "/terms";

export const TABMERGER_SURVEY = TABMERGER_DEMO_SITE + "/survey";

export const TABMERGER_PRICING = TABMERGER_DEMO_SITE + "/pricing";

export const TABMERGER_CONTACT = TABMERGER_DEMO_SITE + "/contact";

// EXTENSION
export const EXTENSION_PAGE_LINK = `chrome://extensions?id=${chrome.runtime.id}`;

export const DOWNLOADS_URL = "chrome://downloads";

// DEFAULT
export const DEFAULT_FAVICON_URL = "https://developer.chrome.com/images/meta/favicon-32x32.png";

export const GOOGLE_HOMEPAGE = "https://www.google.com";

export const CHROME_SHORTCUTS = "chrome://extensions/shortcuts";

export const CHROME_NEW_TAB = "chrome://newtab";

// LICENSE
const GITHUB_BASE_URL = "https://github.com";

const TABMERGER_REPO = GITHUB_BASE_URL + "/lbragile/TabMerger";
const TABMERGER_LICENSE = TABMERGER_REPO + "/blob/master/LICENSE.md";

const REACT_BEAUTIFUL_DND_REPO = GITHUB_BASE_URL + "/atlassian/react-beautiful-dnd";
const REACT_BEAUTIFUL_DND_LICENSE = REACT_BEAUTIFUL_DND_REPO + "/blob/master/LICENSE";

const REACT_REPO = GITHUB_BASE_URL + "/facebook/react";
const REACT_LICENSE = REACT_REPO + "/blob/main/LICENSE";

const REACT_DROPZONE_REPO = GITHUB_BASE_URL + "/react-dropzone/react-dropzone";
const REACT_DROPZONE_LICENSE = REACT_DROPZONE_REPO + "/blob/master/LICENSE";

const REACT_MULTI_SELECT_COMPONENT_REPO = GITHUB_BASE_URL + "/hc-oss/react-multi-select-component";
const REACT_MULTI_SELECT_COMPONENT_LICENSE = REACT_MULTI_SELECT_COMPONENT_REPO + "/blob/master/LICENSE";

const STYLED_COMPONENTS_REPO = GITHUB_BASE_URL + "/styled-components/styled-components";
const STYLED_COMPONENTS_LICENSE = STYLED_COMPONENTS_REPO + "/blob/main/LICENSE";

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
  ReactDropzone: {
    repo: REACT_DROPZONE_REPO,
    license: REACT_DROPZONE_LICENSE
  },
  ReactMultiSelectComponent: {
    repo: REACT_MULTI_SELECT_COMPONENT_REPO,
    license: REACT_MULTI_SELECT_COMPONENT_LICENSE
  },
  StyledComponents: {
    repo: STYLED_COMPONENTS_REPO,
    license: STYLED_COMPONENTS_LICENSE
  },
  NanoID: {
    repo: NANOID_REPO,
    license: NANOID_LICENSE
  }
};

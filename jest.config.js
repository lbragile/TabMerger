module.exports = {
  moduleNameMapper: {
    "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
      "<rootDir>/__mocks__/fileMock.js",
    "\\.(css|less)$": "<rootDir>/__mocks__/styleMock.js",
  },

  setupFiles: ["<rootDir>/__mocks__/chromeMock.js"],

  coverageThreshold: {
    global: {
      statements: 50,
      branches: 50,
      functions: 50,
      lines: 50,
    },
  },

  globals: {
    init_groups: {
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
      "group-10": {
        color: "#123123",
        created: "01/01/2021 @ 12:34:56",
        tabs: [
          {
            title: "A",
            url: "https://www.a.com/",
          },
        ],
        title: "A",
      },
      "group-9": {
        color: "#456456",
        created: "10/09/2021 @ 12:11:10",
        tabs: [
          {
            title: "B",
            url: "https://www.b.com/",
          },
        ],
        title: "B",
      },
    },

    default_settings: {
      blacklist: "",
      color: "#dedede",
      dark: true,
      open: "without",
      restore: "keep",
      title: "Title",
    },

    default_group: {
      color: "#dedede",
      created: "",
      tabs: [],
      title: "Title",
    },
  },
};
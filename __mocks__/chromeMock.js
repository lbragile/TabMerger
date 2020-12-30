global.chrome = {
  browserAction: {
    onClicked: {
      addListener: function () {},
    },
  },
  contextMenus: {
    create: function () {},
    onClicked: {
      addListener: function () {},
    },
    onCommand: {
      addListener: function () {},
    },
  },
  i18n: {
    getMessage: function () {},
  },
  runtime: {
    id: "ldhahppapilmnhocniaifnlieiofgnii",
    setUninstallURL: function () {},
    onMessage: {
      addListener: function () {},
    },
  },
  storage: {
    local: {
      clear: function () {
        localStorage.clear();
      },
      get: function (key, cb) {
        const item = JSON.parse(localStorage.getItem(key));
        cb({ [key]: item });
      },
      remove: function (keys, cb) {
        if (Array.isArray(keys)) {
          keys.forEach((key) => {
            localStorage.removeItem(key);
          });
        } else {
          localStorage.removeItem(keys);
        }

        cb();
      },
      set: function (obj, cb) {
        const key = Object.keys(obj)[0];
        localStorage.setItem(key, JSON.stringify(obj[key]));
        cb();
      },
    },
    sync: {
      clear: function () {
        sessionStorage.clear();
      },
      get: function (key, cb) {
        const item = JSON.parse(sessionStorage.getItem(key));
        cb({ [key]: item });
      },
      remove: function (keys, cb) {
        if (Array.isArray(keys)) {
          keys.forEach((key) => {
            sessionStorage.removeItem(key);
          });
        } else {
          sessionStorage.removeItem(keys);
        }

        cb();
      },
      set: function (obj, cb) {
        const key = Object.keys(obj)[0];
        sessionStorage.setItem(key, JSON.stringify(obj[key]));
        cb();
      },
    },
    onChanged: {
      addListener: function () {},
      removeListener: function () {},
    },
  },
  tabs: {
    create: function () {},
    move: function () {},
    query: function () {},
    remove: function () {},
    update: function () {},
    onUpdated: {
      addListener: function () {},
      removeListener: function () {},
    },
  },
};

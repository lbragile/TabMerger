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
    getMessage: function (msg) {
      if (msg === "Title") {
        return "титул";
      } else {
        throw new Error("Translation for input does not exist");
      }
    },
  },
  runtime: {
    id: "ldhahppapilmnhocniaifnlieiofgnii",
    setUninstallURL: function () {},
    sendMessage: function () {},
    onMessage: {
      addListener: function () {},
    },
  },
  storage: {
    local: {
      get: function (keys, cb) {
        var item;
        if (keys) {
          var local = {};
          // create array if not already
          keys = Array.isArray(keys) ? keys : [keys];
          keys.forEach((key) => {
            // can be a simple string or a stringify
            try {
              local[key] = JSON.parse(localStorage.getItem(key));
            } catch (err) {
              local[key] = localStorage.getItem(key);
            }
          });
          cb(local);
        } else {
          item = { ...localStorage };
          Object.keys(item).forEach((key) => {
            item[key] = JSON.parse(item[key]);
          });
          cb(item);
        }
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
      get: function (key, cb) {
        var item;
        if (key) {
          item = JSON.parse(sessionStorage.getItem(key));
          cb({ [key]: item });
        } else {
          item = { ...sessionStorage };
          Object.keys(item).forEach((key) => {
            item[key] = JSON.parse(item[key]);
          });
          cb(item);
        }
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
    create: function (obj) {
      var open_tabs = JSON.parse(sessionStorage.getItem("open_tabs"));
      open_tabs.push(obj);
      sessionStorage.setItem("open_tabs", JSON.stringify(open_tabs));
    },
    move: function (id, _) {
      var open_tabs = JSON.parse(sessionStorage.getItem("open_tabs"));

      var tab_to_move = open_tabs.filter((x) => x.id === id);
      var index = open_tabs.indexOf(tab_to_move[0]);
      open_tabs.push(open_tabs.splice(index, 1)[0]); // move it to the end

      sessionStorage.setItem("open_tabs", JSON.stringify(open_tabs));
    },
    query: function (_, cb) {
      var open_tabs = JSON.parse(sessionStorage.getItem("open_tabs"));
      cb(open_tabs);
    },
    remove: function (ids) {
      var open_tabs = JSON.parse(sessionStorage.getItem("open_tabs"));
      var remain_open_tabs = open_tabs.filter((x) => !ids.includes(x.id));
      sessionStorage.setItem("open_tabs", JSON.stringify(remain_open_tabs));
    },
    update: function () {},
    onUpdated: {
      addListener: function () {},
      removeListener: function () {},
    },
  },
};

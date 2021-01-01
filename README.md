# ![tabmerger logo](./public/images/logo-full-rescale.PNG)

[![Build](https://img.shields.io/github/workflow/status/lbragile/TabMerger/TabMerger%20Unit%20Testing?label=Build)](https://github.com/lbragile/TabMerger/actions) [![Coverage](https://img.shields.io/codecov/c/github/lbragile/TabMerger?label=Coverage)](https://app.codecov.io/gh/lbragile/TabMerger/) [![Issues](https://img.shields.io/github/issues/lbragile/TabMerger?label=Issues)](https://github.com/lbragile/TabMerger/issues) [![Forks](https://img.shields.io/github/forks/lbragile/TabMerger?label=Forks)](https://github.com/lbragile/TabMerger) [![Stars](https://img.shields.io/github/stars/lbragile/TabMerger?label=Stars)](https://github.com/lbragile/TabMerger) [![Chrome Users](https://img.shields.io/chrome-web-store/users/inmiajapbpafmhjleiebcamfhkfnlgoc?label=Chrome%20Users)](https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc) [![Chrome Rating](https://img.shields.io/chrome-web-store/rating/inmiajapbpafmhjleiebcamfhkfnlgoc?label=Chrome%20Rating)](https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc) [![Firefox Users](https://img.shields.io/amo/users/%7B19feb84f-3a0b-4ca3-bbae-211b52eb158b%7D?label=Firefox%20Users)](https://addons.mozilla.org/en-US/firefox/addon/tabmerger/) [![Firfox Rating](https://img.shields.io/amo/rating/%257B19feb84f-3a0b-4ca3-bbae-211b52eb158b%257D?label=Firefox%20Rating)](https://addons.mozilla.org/en-US/firefox/addon/tabmerger/) [![contributions welcome](https://img.shields.io/badge/Contributions-welcome-brightgreen.svg?style=flat)](https://github.com/lbragile/TabMerger) [![Active Development](https://img.shields.io/badge/Maintenance-active-brightgreen.svg)](https://github.com/lbragile/TabMerger) [![Code Size](https://img.shields.io/github/languages/code-size/lbragile/TabMerger?label=Code%20Size)](https://github.com/lbragile/TabMerger/) [![License](https://img.shields.io/github/license/lbragile/tabmerger?label=License)](https://github.com/lbragile/TabMerger/blob/master/LICENSE.md)

[<img src="https://i.imgur.com/gXUxra5.png" alt="Chrome" width="48px" height="48px" />](https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc) <span style="margin: 0 10px 0 0"></span>[<img src="https://i.imgur.com/VLhu3y6.png" alt="Firefox" width="48px" height="48px" />](https://addons.mozilla.org/en-CA/firefox/addon/tabmerger/) [<img src="https://i.imgur.com/3LuWU6A.png" alt="Edge" width="48px" height="48px" />](https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn)

### Merges your tabs into one location to save memory usage and increase your productivity.

[<img src="https://i.imgur.com/gVmsvKp.png" alt="TabMerger v1.4.3 Cross-Browser Extension Walkthrough"/>](https://youtu.be/zkI0T-GzmzQ)

## Description 🖋

Tired of searching through squished tab icons to find that one tab you are sure is there? With TabMerger you can simplify this clutter while greatly increasing productivity in a highly organized and customizable fashion!

With a single click, you can have all your tabs in a single place, where you can then re-arrange them into appropriate groups, delete extra/unwanted tabs, customize group colors, and so much more. All tabs that are merged into TabMerger are stored internally for you to use at a later time, even when you close the browser window. Lots of analytics are provided to keep you informed about the state of your tabs.

In addition to reducing the heavy tab clutter, TabMerger significantly reduces the memory usage of your machine as on average each chrome tab can use **25MB-100MB of RAM**. These add up quickly if left open and can significantly slow down your machine, but with TabMerger you simply have a list of tabs which can be re-opened when you really need them.

## Contributing 🤗

Contributions are more than welcomed here, but first please refer to the <a href="https://github.com/lbragile/TabMerger/blob/master/CONTRIBUTING.md"/>CONTRIBUTING.md</a> file for guidelines. Let's make something awesome!

## Download 🔽

Visit the <a href="https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/">Chrome Web Store</a> | <a href="https://addons.mozilla.org/en-CA/firefox/addon/tabmerger/"> Firefox Browser Add-ons</a> | <a href="https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn"> Edge Add-ons</a>.

## Leave A Review ⭐⭐⭐⭐⭐

Was TabMerger useful to you?
If so, consider leaving a positive & meaningful review (<a href="https://chrome.google.com/webstore/detail/tabmerger/inmiajapbpafmhjleiebcamfhkfnlgoc/reviews">Chrome</a> | <a href="https://addons.mozilla.org/en-CA/firefox/addon/tabmerger/">Firefox</a> | <a href="https://microsoftedge.microsoft.com/addons/detail/tabmerger/eogjdfjemlgmbblgkjlcgdehbeoodbfn"> Edge</a>)

👉 It would also mean a lot if you could 🌟 this repository on GitHub! 👈

## Todo :chart_with_upwards_trend:

The following lists the items which need to be crossed off of TabMerger's bucket list (and some that were recently completed/highlights) since the release of **v1.2.1**. See the full list in TabMerger's GitHub <a href="https://github.com/lbragile/TabMerger/projects/1">Project Page</a>.

## Testing In Firefox - Manifest Change Required 😤

To allow Firefox to use `storage.sync()` API, when testing you need to build TabMerger by updating the manifest. To do this, you should replace:

```
"incognito": "split",
```

with

```
"incognito": "spanning",

"browser_specific_settings": {
  "gecko": {
    "id": "{19feb84f-3a0b-4ca3-bbae-211b52eb158b}"
  }
},
```

## Contact :iphone:

📩 If you have any more suggestions please send me a message on GitHub, lbragile@gmail.com, or <a href="https://www.linkedin.com/in/liorbragilevsky/">LinkedIn</a>.

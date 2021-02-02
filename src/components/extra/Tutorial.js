import React from "react";

export const TOUR_STEPS = [
  {
    selector: "#need-btn",
    content: (
      <div className="text-dark my-2">
        Before we begin, please note that you can click this button to replay the tutorial at any time. <br />
        <br />
        Simply click this button and select <b>OK</b> in the confirmation window. <br />
        <br />
        Selecting <i>Cancel</i> will take you to TabMerger's official instructions website.
        <br />
        <br />
        You can use the <b>left</b> and <b>right</b> keyboard keys to navigate back and forth between steps,
        respectively.
      </div>
    ),
    position: [75, document.documentElement.clientHeight / 2],
  },
  {
    selector: "#logo-img",
    content: (
      <div className="text-dark my-2">
        Click here to go directly to the correct TabMerger store depending on your browser.
      </div>
    ),
  },
  {
    selector: ".subtitle",
    content: (
      <div className="text-dark my-2">
        A global counter indicating the number of tabs that are currently in TabMerger. This will update when you
        "merge" tabs into TabMerger (shown later).
      </div>
    ),
  },
  {
    selector: ".search-filter",
    content: (
      <div className="text-dark my-2">
        This can be used to filter tabs by group name or directly. The match happen anywhere in the word (not just start
        or end) and is not case sensitive.
        <br />
        <br />
        <b>Try it now:</b>
        <ul className="ml-4">
          <li>
            Type <kbd>#</kbd> followed by a group name to filter tabs based on their group name. <i>Try "#b"</i>
          </li>
          <li>
            Type a tab's name (without the preceeding <kbd style={{ marginRight: "2px" }}>#</kbd>) to filter tabs (and
            groups) based on that name. <i>Try "Tab e"</i>
          </li>
        </ul>
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".global-btn-row",
    content: (
      <div className="text-dark my-2">
        These buttons affect <b>GLOBAL</b> actions!
      </div>
    ),
    stepInteraction: false,
  },
  {
    selector: "#options-btn",
    content: (
      <div className="text-dark my-2">
        Will navigate to the{" "}
        <a href="/settings/settings.html" target="_blank" rel="noreferrer">
          settings page
        </a>{" "}
        where you can configure TabMerger to your needs.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#print-btn",
    content: (
      <div className="text-dark my-2" style={{ fontSize: "0.95rem" }}>
        Allows you to generate a print friendly PDF page. <br />
        <br />
        <b>Note:</b> To have clickable links in the output PDF file, you must select "Save as PDF" for the{" "}
        <i>Destination</i> drop down in the print preview menu. We recommend checking the "Headers and footers" option
        while unchecking the "Background graphics" option.
        <br />
        <br />
        <b>Try it now!</b>
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#open-all-btn",
    content: (
      <div className="text-dark my-2">
        Restores all your tabs from every group. Restoring behavior can be configured in the{" "}
        <a href="/settings/settings.html" target="_blank" rel="noreferrer">
          settings page
        </a>
        .
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#delete-all-btn",
    content: (
      <div className="text-dark my-2">
        Deletes all <b>unlocked</b> groups and their tabs. Locked groups are not deleted! <br />
        <br /> A default group is created at the bottom of the page to allow direct merging into it (as shown later).
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#export-btn",
    content: (
      <div className="text-dark my-2">
        Generates a JSON file which contains TabMerger's current configuration. This file can be used to restore a given
        configuration at any time as shown next. <br />
        <br />
        <b>Click it</b> to generate a JSON file.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#import-btn",
    content: (
      <div className="text-dark my-2">
        Accepts a JSON file whose structure matches the structure which TabMerger accepts. This is used to restore a
        given configuration from a backup file, but is not necessary for normal operation.
        <br />
        <br />
        <b>Try</b> uploading the JSON file you might have downloaded from the previous step.
        <br />
        <br /> You could also try to upload a file that is not JSON to see what happens. Note that since nothing changed
        in TabMerger, you won't see a difference when you upload.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#sync-write-btn",
    content: (
      <div className="text-dark my-2">
        Allows you to access your current TabMerger configuration on another device as long as you enable syncing and
        sign into the same browser account. <br />
        <br /> Once clicked, the <b>Sync</b> indicator will change from <span style={{ color: "red" }}>red</span> to{" "}
        <span style={{ color: "green" }}>green</span> and will display the current timestamp. If already clicked, the
        timestamp will simply update. This provides the user with information regarding when they last synced. <br />
        <br />
        <b>Give it a try!</b>
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#sync-read-btn",
    content: (
      <div className="text-dark my-2">
        Restores TabMerger's configuration from a synced session. The <b>Sync</b> indicator above must be{" "}
        <span style={{ color: "green" }}>green</span> in order for this to be executed. <br />
        <br /> Once clicked the indicator will change from <span style={{ color: "green" }}>green</span> to{" "}
        <span style={{ color: "red" }}>red</span> and will not show a timestamp. This lets the user know that syncing
        was not performed. <br />
        <br />
        <b>Give it a try!</b>
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#undo-btn",
    content: (
      <div className="text-dark my-2">
        Can be used to restore a given configuration if you accidently clicked on a "close" button which caused tabs to
        be lost. <br />
        <br />
        This only applies to "destructive" actions which change tabs in one or many groups. <br />
        <br />
        Note that <b>up to 15</b> undo states are stored and warnings are provided when the limit is reached.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#add-group-btn",
    content: (
      <div className="text-dark my-2">
        When tabs differ from others in a group, it is better to split them into different groups. This allows you to
        generate a new group, into which you can then merge or drag and drop new tabs (as shown later).
        <br />
        <br />
        Note that both the default group color and title can be configured in TabMerger's{" "}
        <a href="/settings/settings.html" target="_blank" rel="noreferrer">
          settings page
        </a>
        .
        <br />
        <br />
        <b>Try clicking it!</b>
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".group-item",
    content: (
      <div className="text-dark my-2">
        This is a <b>GROUP</b>. All your merged tabs eventually end up in one of these.
      </div>
    ),
    stepInteraction: false,
  },
  {
    selector: ".group-title",
    content: (
      <div className="text-dark my-2">
        Buttons in the title mainly control the group's appearance/functionality but are <b>not</b> responsible for
        merging.
      </div>
    ),
    stepInteraction: false,
  },
  {
    selector: ".merging-container",
    content: (
      <div className="text-dark my-2">
        While buttons inside the group, known as <i>merge buttons</i>, control the merging process inside the
        corresponding group.
      </div>
    ),
    stepInteraction: false,
  },
  {
    selector: ".group-count",
    content: (
      <div className="text-dark my-2">
        Displays the number of tabs in a given group. This is continuously updated as the group changes.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".move-group-btn",
    content: (
      <>
        <div className="text-dark my-2">
          Allows you to <b>Drag and Drop</b> a group in order to reorder tabs on a group-level.
        </div>
        <img src="https://i.imgur.com/L8mSFS3.gif" alt="Drag and drop for groups in TabMerger" />
      </>
    ),
    position: "bottom",
  },
  {
    selector: ".lock-group-btn",
    content: (
      <div className="text-dark my-2">
        Locking a group will prevent you from accidently deleting that group and the tabs inside. Once locked, the group
        (and its tabs) will not be deleted by <i>destructive</i> actions. <br />
        <br /> First lock the group by clicking the lock icon. This will change the current icon to one that is
        "locked". Now that this group is locked, any attempt to delete it or one of its tabs will cause a warning to be
        displayed.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".star-group-btn",
    content: (
      <>
        <div className="text-dark my-2">
          Staring a group will automatically lock it and move it to the top of the page. This is useful when you have
          many groups and want to avoid having to drag and drop. <br />
          <br /> When clicked, the star will be filled. Clicking again will simply unstar the group without any further
          logic being applied.
        </div>
        <img src="https://i.imgur.com/ZLMpCwm.gif" alt="Starring a group in TabMerger" />
      </>
    ),
    position: "bottom",
  },
  {
    selector: ".color-group-btn",
    content: (
      <div className="text-dark my-2">
        This allows you to change the group's background. When clicked a color picker is displayed for intuitive color
        selection.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".visibility-group-btn",
    content: (
      <div className="text-dark my-2">
        Hides all the tabs inside the corresponding group.
        <br />
        <br /> These tabs are still in TabMerger, but they are hidden to reduce the group's height. <br />
        <br />
        Other tabs can be dragged into the hidden group and even merged into it. <br />
        <br />A symbol will be shown to indicate hidden groups.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".open-group-btn",
    content: (
      <div className="text-dark my-2">
        Restores all the tabs within the group. Pinned tabs stay pinned when restored.
        <br />
        <br /> Avoids duplicating existing tabs that are already open in the browser. <br />
        <br />
        In such cases, these are simply moved to the far right side.
        <br />
        <br />
        Behaviour can be configured in{" "}
        <a href="/settings/settings.html" target="_blank" rel="noreferrer">
          settings page
        </a>
        .
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".delete-group-btn",
    content: (
      <div className="text-dark my-2">
        Deletes the group entirely along with all of it's tabs. If the deleted group is the only group in TabMerger, a
        new <i>default</i> group is created using the values found in the{" "}
        <a href="/settings/settings.html" target="_blank" rel="noreferrer">
          settings page
        </a>
        .
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".title-edit-input",
    content: (
      <div className="text-dark my-2">
        Allows you to give each group a meaningful name which can be used to search for many tabs using the search
        filter, shown previously. <br />
        <br />
        <b>Give it a try!</b>
      </div>
    ),

    position: "bottom",
  },
  {
    selector: ".created",
    content: (
      <div className="text-dark my-2">
        Each group has a timestamp to provide better context to the user regarding when the group was created.
      </div>
    ),
  },
  {
    selector: ".merge-btn",
    content: (
      <div className="text-dark my-2">
        Will merge <b>ALL</b> open tabs within the window into this group. If you have any open tabs, go ahead and give
        this a try.
      </div>
    ),
  },
  {
    selector: ".merge-left-btn",
    content: (
      <div className="text-dark my-2">
        Will merge open tabs to the <b>LEFT</b> of TabMerger's tab within the window into this group. If you have any
        open tabs, go ahead and give this a try.
      </div>
    ),
  },
  {
    selector: ".merge-right-btn",
    content: (
      <div className="text-dark my-2">
        Will merge open tabs to the <b>RIGHT</b> of TabMerger's tab within the window into this group. If you have any
        open tabs, go ahead and give this a try.
      </div>
    ),
  },
  {
    selector: "",
    content: (
      <>
        <div className="text-dark my-2">
          Another global feature is provided to achieve similar results. <br />
          If you right click anywhere on any page you will see a menu, known as the <i>Context Menu</i>.<br />
          <br />
          In the menu, you will find TabMerger's context menu options which include the above and a few more merging
          abilities.
          <br />
          <br />
          Any merging action performed by the context menu will be added a new group to the very top of TabMerger's
          page.
          <br />
          <br />
          You can then sort this group using the group drag and drop shown previously. <br />
          <br />
          Additionally, TabMerger provides equivalent shortcut keys (<i>chrome://extensions/shortcuts</i> in Chrome)
          which function exactly like the context menu.
          <br />
          <br />
          <b>Try it now!</b> <br />
          Right click anywhere on this page and you will see TabMerger's context menu. Then, hover over TabMerger's row
          to see its options.
        </div>
        <img src="https://i.imgur.com/tLKbsLS.gif" alt="TabMerger's context menu" />
      </>
    ),
    position: "center",
  },
  {
    selector: ".draggable",
    content: (
      <div className="text-dark my-2">
        Lastly, TabMerger provides <b>TAB</b> level control.
      </div>
    ),
    position: "right",
    stepInteraction: false,
  },
  {
    selector: ".close-tab",
    content: (
      <div className="text-dark my-2">
        Allows you to delete a single tab from a group. Assuming the group is not locked.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".move-tab",
    content: (
      <>
        <div className="text-dark my-2">
          Enables you to drag and drop tabs within groups or from one group to another to re-order/organize your tabs
          just how you like them to be.
        </div>
        <img src="https://i.imgur.com/aQMcL4C.gif" alt="Drag and drop for tabs in TabMerger" />
      </>
    ),
    position: "bottom",
  },
  {
    selector: ".a-tab",
    content: (
      <div className="text-dark my-2">
        Can be used to:
        <ul className="ml-4">
          <li>
            Edit a tab's title within TabMerger (<b>MIDDLE</b> mouse click).
          </li>
          <li>
            Restore a tab (<b>LEFT</b> mouse click).
          </li>
        </ul>
        <b>Give both a try!</b>
      </div>
    ),
    position: "bottom",
  },
  {
    selector: ".pin-tab",
    content: (
      <div className="text-dark my-2">
        Allows users to <b>pin or unpin</b> a tab directly from within TabMerger. Once a tab is restored, it will be
        pinned/unpinned depending on the state shown in TabMerger.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#need-btn",
    content: (
      <div className="text-dark my-2">
        To replay the <b>tutorial</b> or visit TabMerger's{" "}
        <a href="https://lbragile.github.io/TabMerger-Extension/" target="_blank" rel="noreferrer">
          official homepage
        </a>{" "}
        to get support/further instructions.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#quick-btn",
    content: (
      <div className="text-dark my-2">
        A <b>video walkthrough</b> with commentary, highlighting all of the above features.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#donate-btn",
    content: (
      <div className="text-dark my-2">
        Where you can make a <b>donation</b> to TabMerger and show your support!
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#leave-btn",
    content: (
      <div className="text-dark my-2">
        Location where you can leave a meaningful <b>review</b> about your experience with TabMerger for other potential
        users to see.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#contact-btn",
    content: (
      <div className="text-dark my-2">
        Direct navigation to TabMerger <b>support</b> page where an email can be sent to TabMerger's creator &
        maintainer.
      </div>
    ),
    position: "bottom",
  },
  {
    selector: "#my-links",
    content: (
      <div className="text-dark my-2">
        Relevant links to TabMerger's GitHub page along with other social media platforms that I am frequently on and
        can be contacted from.
      </div>
    ),
    position: "right",
  },
  {
    selector: "",
    content: (
      <div className="text-dark my-2">
        If you are a power user or this tutorial did not cover something you were looking for, please visit TabMerger's{" "}
        <a href="https://lbragile.github.io/TabMerger-Extension/" target="_blank" rel="noreferrer">
          official homepage
        </a>{" "}
        for more detailed information. <br />
        <br /> We hope that TabMerger can siginificantly reduce your tab clutter and drastically increase your
        productivity! <br />
        <br /> Cheers!
      </div>
    ),
  },
];

export const TUTORIAL_GROUP = {
  "group-0": {
    color: "#a4ff91",
    created: "",
    hidden: false,
    locked: false,
    starred: true,
    tabs: [
      {
        pinned: false,
        title: "TAB A",
        url:
          "https://www.google.com/search?q=a&oq=a&aqs=chrome..69i57j69i59j69i60l4j5l2.1228j1j4&sourceid=chrome&ie=UTF-8",
      },
      {
        pinned: false,
        title: "TAB B",
        url: "https://www.google.com/search?q=b&oq=b&aqs=chrome..69i57j35i39j69i60l6.702j1j9&sourceid=chrome&ie=UTF-8",
      },
      {
        pinned: false,
        title: "TAB C",
        url:
          "https://www.google.com/search?q=c&oq=c&aqs=chrome..69i57j35i39j69i59j69i60l5.696j1j4&sourceid=chrome&ie=UTF-8",
      },
    ],
    title: "Tutorial Group A (Initially STARRED but UNLOCKED)",
  },
  "group-1": {
    color: "#fff36b",
    created: "",
    hidden: false,
    locked: true,
    starred: false,
    tabs: [
      {
        pinned: false,
        title: "TAB D",
        url:
          "https://www.google.com/search?q=d&oq=d&aqs=chrome..69i57j69i59j69i60l4j5l2.1228j1j4&sourceid=chrome&ie=UTF-8",
      },
      {
        pinned: false,
        title: "TAB E",
        url: "https://www.google.com/search?q=e&oq=e&aqs=chrome..69i57j35i39j69i60l6.702j1j9&sourceid=chrome&ie=UTF-8",
      },
      {
        pinned: true,
        title: "TAB F",
        url:
          "https://www.google.com/search?q=f&oq=f&aqs=chrome..69i57j35i39j69i59j69i60l5.696j1j4&sourceid=chrome&ie=UTF-8",
      },
    ],
    title: "Tutorial Group B (Initially LOCKED)",
  },
  "group-2": {
    color: "#ff756b",
    created: "",
    hidden: true,
    locked: true,
    starred: false,
    tabs: [
      {
        pinned: true,
        title: "TAB G",
        url:
          "https://www.google.com/search?q=g&oq=g&aqs=chrome..69i57j69i59j69i60l4j5l2.1228j1j4&sourceid=chrome&ie=UTF-8",
      },
      {
        pinned: false,
        title: "TAB H",
        url: "https://www.google.com/search?q=h&oq=h&aqs=chrome..69i57j35i39j69i60l6.702j1j9&sourceid=chrome&ie=UTF-8",
      },
      {
        pinned: true,
        title: "TAB I",
        url:
          "https://www.google.com/search?q=i&oq=i&aqs=chrome..69i57j35i39j69i59j69i60l5.696j1j4&sourceid=chrome&ie=UTF-8",
      },
    ],
    title: "Tutorial Group C (Initially LOCKED & 'HIDDEN')",
  },
  "group-3": {
    color: "#dedede",
    created: "",
    hidden: false,
    locked: false,
    starred: false,
    tabs: [],
    title: "Tutorial Group D (No Tabs - Default Color)",
  },
  "group-4": {
    color: "#000000",
    created: "",
    hidden: false,
    locked: false,
    starred: false,
    tabs: [
      {
        pinned: true,
        title: "TAB I",
        url:
          "https://www.google.com/search?q=i&oq=i&aqs=chrome..69i57j69i59j69i60l4j5l2.1228j1j4&sourceid=chrome&ie=UTF-8",
      },
      {
        pinned: false,
        title: "TAB J",
        url: "https://www.google.com/search?q=j&oq=j&aqs=chrome..69i57j35i39j69i60l6.702j1j9&sourceid=chrome&ie=UTF-8",
      },
    ],
    title: "Tutorial Group E (Showing High Contrast)",
  },
};

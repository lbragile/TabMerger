/// <reference types="cypress" />

describe("App Tests", () => {
  beforeEach(() => {
    cy.fixture("groups").then((data) => {
      window.localStorage.setItem("groups", JSON.stringify(data));
    });
    window.localStorage.setItem("tabTotal", 6);
    cy.visit("chrome-extension://kdkfmpamdkkhmoomellenejnnajpfhpk/index.html");
  });

  context("Basic Functionality for Tabs", () => {
    const tab_elems = [".close-tab", ".img-tab", ".a-tab"];

    it("renders everything", () => {
      cy.get("#merge-btn");
      cy.contains("h1", "TabMerger");

      cy.get("#tab-total").should("have.text", "6 tabs in total");

      var details = [
        {
          tabs: 2,
          color: "rgb(255, 204, 204)",
          title: "Group-0",
          percent: "(33.33%)",
        },
        {
          tabs: 4,
          color: "rgb(204, 204, 255)",
          title: "Group-1",
          percent: "(66.67%)",
        },
      ];

      details.forEach((item, index) => {
        cy.get(".tabTotal-inGroup")
          .eq(index)
          .should("have.text", item.tabs + " tabs in group " + item.percent);

        cy.get(".group-title")
          .eq(index)
          .should(
            "have.css",
            "background",
            item.color +
              " none repeat scroll 0% 0% / auto padding-box border-box"
          )
          .and("have.text", item.title);
      });
    });

    it("displays the correct tabs", () => {
      tab_elems.forEach((elem) => {
        cy.get(elem).should(
          "have.length",
          window.localStorage.getItem("tabTotal")
        );
      });
    });

    it("works with empty tabs", () => {
      cy.fixture("empty").then((data) => {
        window.localStorage.setItem("groups", JSON.stringify(data));
      });
      cy.reload();

      tab_elems.forEach((elem) => {
        cy.get(elem).should("not.exist");
      });

      cy.get("#tab-total").should("have.text", "0 tabs in total");
      cy.get(".tabTotal-inGroup").should("have.text", "0 tabs in group ");
      cy.get(".group-title")
        .eq(0)
        .should(
          "have.css",
          "background",
          "rgb(201, 201, 201) none repeat scroll 0% 0% / auto padding-box border-box"
        )
        .and("have.text", "General");
    });

    it("removes tab on click", () => {
      function removeTab(index, left) {
        cy.get("#tab-total").should("have.text", left + 1 + " tabs in total");

        cy.get(tab_elems[0])
          .eq(index)
          .then(($elem) => {
            cy.wrap($elem).click();
          });

        tab_elems.forEach((elem) => {
          cy.get(elem).should("have.length", left);
        });

        cy.get("#tab-total").should("have.text", left + " tabs in total");
      }

      var currentTabs = window.localStorage.getItem("tabTotal");
      removeTab(0, --currentTabs);
      cy.get(".tabTotal-inGroup").eq(0).should("contain", "1 tab in group");
      cy.get(".group-title").eq(0).should("have.text", "Group-0");

      removeTab(3, --currentTabs);
      cy.get(".tabTotal-inGroup").eq(1).should("contain", "3 tabs in group");
      cy.get(".group-title").eq(1).should("have.text", "Group-1");
    });
  });

  context("User Input", () => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;

    // https://github.com/cypress-io/cypress/issues/1570
    it("changes the background color of a group", () => {
      cy.get("#add-group-btn").click();
      cy.get("input[type=color]").should("have.length", 3);

      var colors_hex = ["#ff0000", "#00ff00"];
      var colors_rgb = ["rgb(255, 0, 0)", "rgb(0, 255, 0)"];

      colors_hex.forEach((color, index) => {
        cy.get("input[type=color]")
          .eq(index)
          .then(($input) => {
            nativeInputValueSetter.call($input[0], color);
            $input[0].dispatchEvent(
              new Event("change", { value: color, bubbles: true })
            );
          });

        if (index === 1) cy.get("#add-group-btn").click();

        cy.get(".group-title")
          .eq(index)
          .should(
            "have.css",
            "background",
            colors_rgb[index] +
              " none repeat scroll 0% 0% / auto padding-box border-box"
          );
      });

      cy.get("input[type=color]").should("have.length", 4);
    });

    it("edits group title", () => {
      var group_title = ".styles_Editext__button__6H8n_";
      var title_input = ".styles_Editext__input__1534X";
      var save_btn = ".styles_Editext__save_button__3WN6q";
      var cancel_btn = ".styles_Editext__cancel_button__259hb";

      cy.get("#add-group-btn").click();
      var title_text = ["Test", "Success"];

      title_text.forEach((title, index) => {
        cy.get(group_title).eq(index).click();
        cy.get(title_input).clear().type(title);
        cy.get(save_btn).click();
        cy.get("div[editext='view']").eq(index).should("have.text", title);

        cy.get(group_title).eq(index).click();
        cy.get(title_input)
          .clear()
          .type(title + "!");
        cy.get(cancel_btn).click();
        cy.get("div[editext='view']").eq(index).should("have.text", title);
      });
    });
  });
});

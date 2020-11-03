/// <reference types="cypress" />

describe("App Tests", () => {
  beforeEach(() => {
    cy.visit(Cypress.config().baseUrl);
    cy.fixture("tab").then((data) => {
      window.localStorage.setItem("tabs", JSON.stringify(Object.values(data)));
    });
  });

  context("Basic Functionality for Tabs", () => {
    const tab_elems = [".close-tab", ".img-tab", ".a-tab"];

    it("renders everything", () => {
      cy.get("#merge-btn");
      cy.contains("h1", "Tabify");
      cy.contains("h5", "total");
    });

    it("displays the correct tabs", () => {
      var tabs = JSON.parse(localStorage.getItem("tabs"));

      cy.get("#merge-btn").click(); // for coverage (does not do anything)

      cy.window().then((win) => {
        win.postMessage({ tabs }, "http://localhost:3000/");
      });

      tab_elems.forEach((elem) => {
        cy.get(elem).should("have.length", 6);
      });
    });

    it("works with empty tabs", () => {
      cy.clearLocalStorage();
      cy.window().then((win) => {
        win.postMessage({ tabs: [] }, "http://localhost:3000/");
      });

      tab_elems.forEach((elem) => {
        cy.get(elem).should("not.exist");
      });
    });

    it("removes tab on click", () => {
      var tabs = JSON.parse(localStorage.getItem("tabs"));

      cy.window().then((win) => {
        win.postMessage({ tabs }, "http://localhost:3000/");
      });

      cy.contains("h5", "6 tabs total");

      cy.get(tab_elems[0])
        .first()
        .then(($elem) => {
          cy.wrap($elem).click();
        });

      tab_elems.forEach((elem) => {
        cy.get(elem).should("have.length", 5);
      });

      cy.contains("h5", "5 tabs total");
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
      cy.get("input[type=color]").should("have.length", 2);

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

      cy.get("input[type=color]").should("have.length", 3);
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

/// <reference types="cypress" />

describe("App Tests", () => {
  const tab_elems = [".close-tab", ".img-tab", ".a-tab"];
  beforeEach(() => {
    cy.visit(Cypress.config().baseUrl);
    cy.fixture("tab").then((data) => {
      window.localStorage.setItem("tabs", JSON.stringify(Object.values(data)));
    });
  });

  it("renders everything", () => {
    cy.get("#merge-btn");
    cy.contains("h1", "Tabify");
    cy.contains("h5", "Currently");
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
    cy.reload();
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

    cy.contains("h5", "Currently have 6 tabs");

    cy.get(tab_elems[0])
      .first()
      .then(($elem) => {
        cy.wrap($elem).click();
      });

    tab_elems.forEach((elem) => {
      cy.get(elem).should("have.length", 5);
    });

    cy.contains("h5", "Currently have 5 tabs");
  });
});

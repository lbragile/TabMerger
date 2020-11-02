/// <reference types="cypress" />

describe("App Tests", () => {
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

    cy.get("#merge-btn").click();

    cy.window().then((win) => {
      win.postMessage({ tabs }, "http://localhost:3000/");
    });

    // cy.log(JSON.parse(localStorage.getItem("tabs")).length);
    // cy.expect(localStorage.getItem("tabs")).to.have.lengthOf(5);
  });
});

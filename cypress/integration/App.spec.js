/// <reference types="cypress" />

describe("App Tests", () => {
  beforeEach(() => {
    cy.visit(Cypress.config().baseUrl);
    // cy.fixture("tab").then((data) => {
    //   window.localStorage.setItem(
    //     "tabs",
    //     JSON.stringify(Object.values(data).map((item) => JSON.stringify(item)))
    //   );
    // });
  });

  it("renders everything", () => {
    cy.contains("button", "Merge");
    cy.contains("h1", "Tabify");
    cy.contains("h5", "Currently");
  });

  it.only("displays the correct tabs", () => {
    // var tabs = JSON.parse(localStorage.getItem("tabs"));

    // // open the tabs
    // var windows = [];
    // tabs.forEach((tab) => {
    //   windows.push(window.open(JSON.parse(tab).url));
    // });

    cy.contains("button", "Merge").click();
    cy.visit(Cypress.config().baseUrl);

    // // close the extra tabs
    // windows.forEach((window) => window.close());

    // cy.log(JSON.parse(localStorage.getItem("tabs")).length);
    // cy.expect(localStorage.getItem("tabs")).to.have.lengthOf(5);
  });
});

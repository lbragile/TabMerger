import { describe, it, expect } from "vitest";
import { FIREFOX_BETA } from "@tabmerger/shared";
import { resolveFirefoxBetaUpdateUrl } from "./firefoxBetaUpdateUrl";

describe("resolveFirefoxBetaUpdateUrl", () => {
  it("builds the update_url from a web app URL and the shared FIREFOX_BETA path", () => {
    expect(resolveFirefoxBetaUpdateUrl("https://tabmerger-preview.vercel.app")).toBe(
      `https://tabmerger-preview.vercel.app${FIREFOX_BETA.PATH}/${FIREFOX_BETA.UPDATES_FILE}`,
    );
  });

  it("throws when VITE_WEB_APP_URL is unset, instead of shipping a beta that can never update", () => {
    expect(() => resolveFirefoxBetaUpdateUrl(undefined)).toThrow(/VITE_WEB_APP_URL/);
  });

  it("throws on an empty string too", () => {
    expect(() => resolveFirefoxBetaUpdateUrl("")).toThrow(/VITE_WEB_APP_URL/);
  });
});

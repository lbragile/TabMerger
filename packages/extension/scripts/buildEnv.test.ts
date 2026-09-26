import { describe, expect, it } from "vitest";
import {
  getCliModeFlag,
  isServeCommand,
  resolveNodeEnv,
  resolveWxtModeFromArgv,
} from "./buildEnv";

describe("resolveNodeEnv", () => {
  it("maps 'development' to 'development'", () => {
    expect(resolveNodeEnv("development")).toBe("development");
  });

  it("maps 'production' to 'production'", () => {
    expect(resolveNodeEnv("production")).toBe("production");
  });

  it("collapses 'beta' to 'production' (regression: beta shipped dev React before this fix)", () => {
    expect(resolveNodeEnv("beta")).toBe("production");
  });

  it("collapses 'demo' to 'production'", () => {
    expect(resolveNodeEnv("demo")).toBe("production");
  });

  it("collapses any other unrecognized mode to 'production'", () => {
    expect(resolveNodeEnv("staging")).toBe("production");
  });
});

describe("getCliModeFlag", () => {
  it("reads the long '--mode' flag", () => {
    expect(getCliModeFlag(["wxt", "zip", "-b", "chrome", "--mode", "beta"])).toBe("beta");
  });

  it("reads the short '-m' flag", () => {
    expect(getCliModeFlag(["wxt", "build", "-m", "demo"])).toBe("demo");
  });

  it("returns undefined when no mode flag is present", () => {
    expect(getCliModeFlag(["wxt", "build"])).toBeUndefined();
  });

  it("returns undefined when the flag is the last argv entry with no value", () => {
    expect(getCliModeFlag(["wxt", "build", "--mode"])).toBeUndefined();
  });

  it("prefers '--mode' over '-m' when both are somehow present", () => {
    expect(getCliModeFlag(["wxt", "build", "-m", "demo", "--mode", "beta"])).toBe("beta");
  });
});

describe("isServeCommand", () => {
  it("is true for the bare dev server invocation", () => {
    expect(isServeCommand(["wxt"])).toBe(true);
  });

  it("is false for 'build'", () => {
    expect(isServeCommand(["wxt", "build"])).toBe(false);
  });

  it("is false for 'zip'", () => {
    expect(isServeCommand(["wxt", "zip", "-b", "chrome", "--mode", "beta"])).toBe(false);
  });
});

describe("resolveWxtModeFromArgv", () => {
  it("uses the explicit '--mode' flag for a zip build", () => {
    expect(resolveWxtModeFromArgv(["wxt", "zip", "-b", "chrome", "--mode", "beta"])).toBe("beta");
  });

  it("uses the explicit '-m' flag for a build", () => {
    expect(resolveWxtModeFromArgv(["wxt", "build", "-m", "demo"])).toBe("demo");
  });

  it("defaults an explicit 'build' with no mode flag to 'production'", () => {
    expect(resolveWxtModeFromArgv(["wxt", "build"])).toBe("production");
  });

  it("defaults the bare dev server (no subcommand, no mode flag) to 'development'", () => {
    expect(resolveWxtModeFromArgv(["wxt"])).toBe("development");
  });

  it("respects an explicit '--mode development' even for a 'build' subcommand", () => {
    expect(resolveWxtModeFromArgv(["wxt", "build", "--mode", "development"])).toBe("development");
  });
});

describe("resolveNodeEnv(resolveWxtModeFromArgv(...)) end-to-end mapping", () => {
  it("a beta store zip build resolves to NODE_ENV=production", () => {
    const mode = resolveWxtModeFromArgv(["wxt", "zip", "-b", "chrome", "--mode", "beta"]);
    expect(resolveNodeEnv(mode)).toBe("production");
  });

  it("a demo build resolves to NODE_ENV=production", () => {
    const mode = resolveWxtModeFromArgv(["wxt", "build", "-m", "demo"]);
    expect(resolveNodeEnv(mode)).toBe("production");
  });

  it("a --mode development build stays NODE_ENV=development", () => {
    const mode = resolveWxtModeFromArgv(["wxt", "build", "--mode", "development"]);
    expect(resolveNodeEnv(mode)).toBe("development");
  });

  it("the plain dev server stays NODE_ENV=development", () => {
    const mode = resolveWxtModeFromArgv(["wxt"]);
    expect(resolveNodeEnv(mode)).toBe("development");
  });

  it("a default production build (no flags) stays NODE_ENV=production", () => {
    const mode = resolveWxtModeFromArgv(["wxt", "build"]);
    expect(resolveNodeEnv(mode)).toBe("production");
  });
});

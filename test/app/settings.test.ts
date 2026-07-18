import { describe, expect, it } from "vitest";
import {
  defaultFlowCliSettings,
  normalizeFlowCliSettings,
} from "../../src/app/settings.js";

describe("FlowCLI settings", () => {
  it("uses Flow-style editor defaults", () => {
    expect(defaultFlowCliSettings.cursor).toEqual({
      shape: "block",
      blinking: true,
    });
    expect(normalizeFlowCliSettings(null)).toEqual(defaultFlowCliSettings);
  });

  it("normalizes persisted settings and bounds the autosave delay", () => {
    expect(normalizeFlowCliSettings({
      autosave: false,
      autosaveDelayMs: 1,
      theme: "solarized-dark-theme",
      graphics: "kitty",
      mode: "source",
      cursor: { shape: "bar", blinking: false },
      keybindings: { "flow.open": "Alt+O", invalid: 42 },
    })).toEqual({
      autosaveDelayMs: 250,
      theme: "solarized-dark-theme",
      graphics: "kitty",
      cursor: { shape: "bar", blinking: false },
      keybindings: { "flow.open": "Alt+O" },
    });
  });

  it("migrates legacy terminal theme names", () => {
    expect(normalizeFlowCliSettings({ theme: "dark" }).theme)
      .toBe("default-dark-theme");
    expect(normalizeFlowCliSettings({ theme: "monochrome" }).theme)
      .toBe("default-dark-theme");
  });
});

import {
  isFlowCliThemeId,
  type FlowCliThemeId,
} from "./theme.js";

export interface FlowCliSettings {
  readonly autosaveDelayMs: number;
  readonly theme: FlowCliThemeId;
  readonly graphics: "auto" | "none" | "kitty" | "iterm2";
  readonly cursor: {
    readonly shape: "block" | "underline" | "bar";
    readonly blinking: boolean;
  };
  readonly keybindings: Readonly<Record<string, string>>;
}

export const defaultFlowCliSettings: FlowCliSettings = {
  autosaveDelayMs: 1500,
  theme: "default-theme",
  graphics: "auto",
  cursor: {
    shape: "block",
    blinking: true,
  },
  keybindings: {},
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

export const normalizeFlowCliSettings = (value: unknown): FlowCliSettings => {
  if (!isRecord(value)) return defaultFlowCliSettings;
  const autosaveDelayMs =
    typeof value.autosaveDelayMs === "number" &&
      Number.isFinite(value.autosaveDelayMs)
      ? Math.max(250, Math.min(60_000, Math.round(value.autosaveDelayMs)))
      : defaultFlowCliSettings.autosaveDelayMs;
  const theme = isFlowCliThemeId(value.theme)
    ? value.theme
    : value.theme === "dark" || value.theme === "monochrome"
      ? "default-dark-theme"
      : defaultFlowCliSettings.theme;
  const graphics = ["auto", "none", "kitty", "iterm2"].includes(
      String(value.graphics),
    )
    ? value.graphics as FlowCliSettings["graphics"]
    : defaultFlowCliSettings.graphics;
  const cursor = isRecord(value.cursor)
    ? {
        shape: ["block", "underline", "bar"].includes(String(value.cursor.shape))
          ? value.cursor.shape as FlowCliSettings["cursor"]["shape"]
          : defaultFlowCliSettings.cursor.shape,
        blinking: typeof value.cursor.blinking === "boolean"
          ? value.cursor.blinking
          : defaultFlowCliSettings.cursor.blinking,
      }
    : defaultFlowCliSettings.cursor;
  const keybindings = isRecord(value.keybindings)
    ? Object.fromEntries(
        Object.entries(value.keybindings).filter(
          (entry): entry is [string, string] =>
            entry[0].length > 0 &&
            typeof entry[1] === "string" &&
            entry[1].trim().length > 0,
        ),
      )
    : {};
  return {
    autosaveDelayMs,
    theme,
    graphics,
    cursor,
    keybindings,
  };
};

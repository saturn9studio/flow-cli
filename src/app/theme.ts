import { flowCliDarkTheme } from "../markdown/index.js";
import type {
  ResolvedStyle,
  RgbColor,
  TerminalColor,
  TerminalTheme,
} from "../engine/index.js";

export const FLOW_CLI_THEME_IDS = [
  "default-theme",
  "default-dark-theme",
  "latte-theme",
  "mocha-theme",
  "solarized-light-theme",
  "solarized-dark-theme",
] as const;

export type FlowCliThemeId = (typeof FLOW_CLI_THEME_IDS)[number];

interface ThemePalette {
  readonly id: FlowCliThemeId;
  readonly label: string;
  readonly backgroundPrimary: string;
  readonly backgroundSecondary: string;
  readonly backgroundTertiary: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly border: string;
  readonly active: string;
  readonly accent: string;
  readonly highlightForeground: string;
  readonly highlightBackground: string;
  readonly secondaryAccent: string;
}

const palettes: readonly ThemePalette[] = [
  {
    id: "default-theme",
    label: "Basic Light",
    backgroundPrimary: "#ffffff",
    backgroundSecondary: "#f5f5f5",
    backgroundTertiary: "#e8e8e8",
    textPrimary: "#333333",
    textSecondary: "#777777",
    textMuted: "#cccccc",
    border: "#cccccc",
    active: "#333333",
    accent: "#007acc",
    highlightForeground: "#333333",
    highlightBackground: "#ffff00",
    secondaryAccent: "#0078d4",
  },
  {
    id: "default-dark-theme",
    label: "Basic Dark",
    backgroundPrimary: "#000000",
    backgroundSecondary: "#141414",
    backgroundTertiary: "#1a1a1a",
    textPrimary: "#cccccc",
    textSecondary: "#999999",
    textMuted: "#777777",
    border: "#333333",
    active: "#cccccc",
    accent: "#cca700",
    highlightForeground: "#cccccc",
    highlightBackground: "#0000ff",
    secondaryAccent: "#cca700",
  },
  {
    id: "latte-theme",
    label: "Latte",
    backgroundPrimary: "#f9f5f0",
    backgroundSecondary: "#e6dfd3",
    backgroundTertiary: "#f0ebe0",
    textPrimary: "#5a4534",
    textSecondary: "#8c7f6a",
    textMuted: "#7a6b4f",
    border: "#a0907a",
    active: "#3a3020",
    accent: "#c74343",
    highlightForeground: "#e6e1d5",
    highlightBackground: "#ff7f50",
    secondaryAccent: "#2e8b57",
  },
  {
    id: "mocha-theme",
    label: "Mocha",
    backgroundPrimary: "#221a15",
    backgroundSecondary: "#2f2420",
    backgroundTertiary: "#1a1010",
    textPrimary: "#d4c0a6",
    textSecondary: "#8c7f6a",
    textMuted: "#5c4f3b",
    border: "#6c5f4b",
    active: "#f0e0d0",
    accent: "#c27f41",
    highlightForeground: "#e6d5c0",
    highlightBackground: "#d45b3e",
    secondaryAccent: "#a0785f",
  },
  {
    id: "solarized-light-theme",
    label: "Solarized Light",
    backgroundPrimary: "#fdf6e3",
    backgroundSecondary: "#dacea4",
    backgroundTertiary: "#eee8d5",
    textPrimary: "#657b83",
    textSecondary: "#a89f84",
    textMuted: "#93a1a1",
    border: "#a7a090",
    active: "#584c27",
    accent: "#dc322f",
    highlightForeground: "#d5e8ee",
    highlightBackground: "#cb4b16",
    secondaryAccent: "#2aa198",
  },
  {
    id: "solarized-dark-theme",
    label: "Solarized Dark",
    backgroundPrimary: "#09202a",
    backgroundSecondary: "#1b363d",
    backgroundTertiary: "#002b36",
    textPrimary: "#96a1a1",
    textSecondary: "#5c6d74",
    textMuted: "#5c6d74",
    border: "#5c6d74",
    active: "#eee8d5",
    accent: "#2aa198",
    highlightForeground: "#eee8d5",
    highlightBackground: "#cb4b16",
    secondaryAccent: "#6c71c4",
  },
];

export const flowCliThemeOptions = palettes.map(({ id, label }) => ({
  id,
  label,
}));

export const isFlowCliThemeId = (value: unknown): value is FlowCliThemeId =>
  typeof value === "string" &&
  FLOW_CLI_THEME_IDS.includes(value as FlowCliThemeId);

const rgb = (hex: string): RgbColor => ({
  red: Number.parseInt(hex.slice(1, 3), 16),
  green: Number.parseInt(hex.slice(3, 5), 16),
  blue: Number.parseInt(hex.slice(5, 7), 16),
});

const syntaxForeground = (
  role: string,
  palette: ThemePalette,
): TerminalColor => {
  if (
    role.includes("keyword") ||
    role.includes("type") ||
    role.includes("meta")
  ) {
    return rgb(palette.accent);
  }
  if (
    role.includes("function") ||
    role.includes("string") ||
    role.includes("regexp")
  ) {
    return rgb(palette.secondaryAccent);
  }
  if (role.includes("comment")) return rgb(palette.textMuted);
  if (role.includes("builtIn") || role.includes("symbol")) {
    return rgb(palette.highlightBackground);
  }
  if (
    role.includes("attribute") ||
    role.includes("literal") ||
    role.includes("number") ||
    role.includes("operator") ||
    role.includes("property") ||
    role.includes("variable")
  ) {
    return rgb(palette.active);
  }
  return rgb(palette.textPrimary);
};

const editorRole = (
  role: string,
  base: ResolvedStyle,
  palette: ThemePalette,
): ResolvedStyle => {
  let foreground: TerminalColor = rgb(palette.textPrimary);
  if (role.startsWith("codeSyntax.")) {
    foreground = syntaxForeground(role, palette);
  } else if (
    role === "markdownListMarker" ||
    role === "markdownQuoteMarker"
  ) {
    foreground = rgb(palette.accent);
  } else if (
    role === "markdownMarkup" ||
    role === "markdownCodeMarkup" ||
    role === "markdownDeleted" ||
    role === "markdownSeparator" ||
    role === "placeholder" ||
    role === "focusInactive" ||
    role === "codeBlockLabel" ||
    role === "tableBorder" ||
    role === "taskUnchecked" ||
    role === "markdownImage.loading" ||
    role === "markdownImage.unavailable"
  ) {
    foreground = rgb(palette.textMuted);
  } else if (
    role === "markdownLink" ||
    role === "markdownUnderline"
  ) {
    foreground = rgb(palette.accent);
  } else if (
    role === "markdownCode" ||
    role === "markdownImage" ||
    role === "taskChecked"
  ) {
    foreground = rgb(palette.secondaryAccent);
  } else if (role === "lint" || role === "markdownImage.error") {
    foreground = rgb("#dc322f");
  } else if (role === "markdownStrong") {
    foreground = rgb(palette.active);
  }

  const style: ResolvedStyle = {
    ...base,
    foreground,
    background: rgb(palette.backgroundPrimary),
  };
  if (
    role === "markdownQuote" ||
    role === "markdownQuoteMarker" ||
    role === "markdownCode" ||
    role === "markdownCodeMarkup" ||
    role === "codeBlockLabel" ||
    role.startsWith("codeSyntax.")
  ) {
    return { ...style, background: rgb(palette.backgroundTertiary) };
  }
  if (role === "markdownHighlight") {
    return {
      ...style,
      foreground: rgb(palette.highlightForeground),
      background: rgb(palette.highlightBackground),
    };
  }
  if (role === "currentSentence" || role === "textHighlight") {
    return { ...style, background: rgb(palette.backgroundTertiary) };
  }
  if (role === "searchMatchActive") {
    return {
      ...style,
      foreground: rgb(palette.backgroundPrimary),
      background: rgb(palette.accent),
    };
  }
  return style;
};

const buildTheme = (palette: ThemePalette): TerminalTheme => {
  const roles = Object.fromEntries(
    Object.entries(flowCliDarkTheme.roles).map(([role, style]) => [
      role,
      editorRole(role, style, palette),
    ]),
  );
  return {
    name: palette.label,
    cursor: rgb(palette.accent),
    roles: {
      ...roles,
      flowStatus: {
        foreground: rgb(palette.textPrimary),
        background: rgb(palette.backgroundTertiary),
        bold: true,
      },
      flowStatusActive: {
        foreground: rgb(palette.backgroundPrimary),
        background: rgb(palette.accent),
        bold: true,
      },
      flowMenu: {
        foreground: rgb(palette.textPrimary),
        background: rgb(palette.backgroundTertiary),
      },
      flowMenuActive: {
        foreground: rgb(palette.backgroundPrimary),
        background: rgb(palette.accent),
        bold: true,
      },
      flowMenuDropdown: {
        foreground: rgb(palette.textPrimary),
        background: rgb(palette.backgroundTertiary),
      },
      flowMenuDisabled: {
        foreground: rgb(palette.textMuted),
        background: rgb(palette.backgroundTertiary),
      },
      flowMenuSelected: {
        foreground: rgb(palette.backgroundPrimary),
        background: rgb(palette.accent),
        bold: true,
      },
      flowEditorMargin: {
        background: rgb(palette.backgroundSecondary),
      },
      flowEditorBackground: {
        background: rgb(palette.backgroundPrimary),
      },
      flowScrollbarTrack: {
        foreground: rgb(palette.border),
        background: rgb(palette.backgroundSecondary),
      },
      flowScrollbarThumb: {
        foreground: rgb(palette.textSecondary),
        background: rgb(palette.backgroundSecondary),
      },
      flowOverlay: {
        foreground: rgb(palette.textPrimary),
        background: rgb(palette.backgroundSecondary),
      },
      flowOverlaySelected: {
        foreground: rgb(palette.backgroundPrimary),
        background: rgb(palette.accent),
        bold: true,
      },
    },
  };
};

export const flowCliThemes: Readonly<Record<FlowCliThemeId, TerminalTheme>> =
  Object.fromEntries(
    palettes.map((palette) => [palette.id, buildTheme(palette)]),
  ) as Record<FlowCliThemeId, TerminalTheme>;

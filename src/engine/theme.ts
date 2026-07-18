import type { RgbColor, TerminalColor, TextStyle } from "./decorations.js";

export type { TerminalColor } from "./decorations.js";

export interface ResolvedStyle {
  readonly foreground?: TerminalColor;
  readonly background?: TerminalColor;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly inverse?: boolean;
}

export interface TerminalTheme {
  readonly name: string;
  readonly roles: Readonly<Record<string, ResolvedStyle>>;
  readonly cursor?: RgbColor;
}

export const darkTheme: TerminalTheme = {
  name: "Terminal Dark",
  roles: {
    text: { foreground: "white" },
    muted: { foreground: "brightBlack", dim: true },
    accent: { foreground: "brightCyan" },
    heading: { foreground: "brightBlue", bold: true },
    emphasis: { foreground: "brightMagenta", italic: true },
    strong: { foreground: "brightWhite", bold: true },
    deleted: { foreground: "brightBlack", strikethrough: true },
    code: { foreground: "brightGreen" },
    border: { foreground: "brightBlack" },
    widget: { foreground: "cyan" },
    selection: { inverse: true },
    status: { foreground: "black", background: "brightWhite", bold: true },
  },
};

export const resolveStyle = (
  style: TextStyle,
  theme: TerminalTheme,
): ResolvedStyle => ({
  ...(style.role ? theme.roles[style.role] : undefined),
  foreground:
    style.foreground ?? (style.role ? theme.roles[style.role]?.foreground : undefined),
  background:
    style.background ??
    (style.role ? theme.roles[style.role]?.background : undefined) ??
    (style.backgroundRole
      ? theme.roles[style.backgroundRole]?.background
      : undefined),
  bold: style.bold ?? (style.role ? theme.roles[style.role]?.bold : undefined),
  dim: style.dim ?? (style.role ? theme.roles[style.role]?.dim : undefined),
  italic: style.italic ?? (style.role ? theme.roles[style.role]?.italic : undefined),
  underline:
    style.underline ?? (style.role ? theme.roles[style.role]?.underline : undefined),
  strikethrough:
    style.strikethrough ??
    (style.role ? theme.roles[style.role]?.strikethrough : undefined),
  inverse:
    style.inverse ?? (style.role ? theme.roles[style.role]?.inverse : undefined),
});

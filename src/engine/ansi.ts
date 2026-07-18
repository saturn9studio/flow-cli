import type { Frame } from "./frame.js";
import { darkTheme, resolveStyle, type ResolvedStyle, type TerminalTheme } from "./theme.js";
import type { NamedTerminalColor, RgbColor, TerminalColor } from "./decorations.js";

const foregroundCodes: Record<NamedTerminalColor, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightBlack: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
};

const isRgbColor = (color: TerminalColor): color is RgbColor =>
  typeof color === "object";

const colorCodes = (
  color: TerminalColor | undefined,
  foreground: boolean,
): readonly number[] => {
  if (!color) return [];
  if (!isRgbColor(color)) {
    return [foreground ? foregroundCodes[color] : foregroundCodes[color] + 10];
  }
  const channel = (value: number): number =>
    Math.max(0, Math.min(255, Math.round(value)));
  return [
    foreground ? 38 : 48,
    2,
    channel(color.red),
    channel(color.green),
    channel(color.blue),
  ];
};

const styleCode = (style: ResolvedStyle): string => {
  const codes = [
    style.bold ? 1 : null,
    style.dim ? 2 : null,
    style.italic ? 3 : null,
    style.underline ? 4 : null,
    style.strikethrough ? 9 : null,
    style.inverse ? 7 : null,
    ...colorCodes(style.foreground, true),
    ...colorCodes(style.background, false),
  ].filter((code): code is number => code !== null);
  return codes.length > 0 ? `\u001b[0;${codes.join(";")}m` : "\u001b[0m";
};

const sameStyle = (a: ResolvedStyle, b: ResolvedStyle): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export interface AnsiRenderOptions {
  readonly theme?: TerminalTheme;
  readonly clear?: boolean;
}

export type TerminalCursorShape = "default" | "block" | "underline" | "bar";

export interface TerminalCursorStyle {
  readonly shape: TerminalCursorShape;
  readonly blinking?: boolean;
}

const renderRow = (
  frame: Frame,
  rowIndex: number,
  theme: TerminalTheme,
): string => {
  const row = frame.rows[rowIndex];
  let output = "";
  let previousStyle: ResolvedStyle = {};
  let visibleCells = 0;
  for (const cell of row.cells.slice(0, frame.width)) {
    visibleCells += 1;
    if (cell.continuation) continue;
    const style = resolveStyle(cell.style, theme);
    if (!sameStyle(style, previousStyle)) {
      output += styleCode(style);
      previousStyle = style;
    }
    output += cell.text;
  }
  if (visibleCells < frame.width) {
    if (!sameStyle(previousStyle, {})) output += styleCode({});
    output += " ".repeat(frame.width - visibleCells);
  } else if (!sameStyle(previousStyle, {})) {
    output += styleCode({});
  }
  return output;
};

const renderCursor = (frame: Frame): string =>
  frame.cursor.visible
    ? `\u001b[${frame.cursor.row + 1};${frame.cursor.column + 1}H\u001b[?25h`
    : "\u001b[?25l";

export const cursorStyleToAnsi = (
  style: TerminalCursorStyle = { shape: "default" },
): string => {
  const code = style.shape === "default"
    ? 0
    : style.shape === "block"
      ? style.blinking === false ? 2 : 1
      : style.shape === "underline"
        ? style.blinking === false ? 4 : 3
        : style.blinking === false ? 6 : 5;
  return `\u001b[${code} q`;
};

export const cursorColorToAnsi = (color?: RgbColor): string => {
  if (!color) return "\u001b]112\u001b\\";
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `\u001b]12;rgb:${channel(color.red)}/${channel(color.green)}/${
    channel(color.blue)
  }\u001b\\`;
};

export const frameToAnsi = (
  frame: Frame,
  options: AnsiRenderOptions = {},
): string => {
  const theme = options.theme ?? darkTheme;
  let output = options.clear === false ? "\u001b[H" : "\u001b[H\u001b[2J";

  frame.rows.forEach((_, rowIndex) => {
    if (rowIndex > 0) output += "\r\n";
    output += renderRow(frame, rowIndex, theme);
  });

  return `${output}\u001b[0m${renderCursor(frame)}`;
};

export const diffFrames = (
  previous: Frame | null,
  next: Frame,
  options: Omit<AnsiRenderOptions, "clear"> = {},
): string => {
  if (!previous || previous.width !== next.width || previous.height !== next.height) {
    return frameToAnsi(next, options);
  }
  if (JSON.stringify(previous) === JSON.stringify(next)) return "";
  const theme = options.theme ?? darkTheme;
  let output = "\u001b[?25l";
  next.rows.forEach((row, rowIndex) => {
    if (JSON.stringify(previous.rows[rowIndex]) === JSON.stringify(row)) return;
    output += `\u001b[${rowIndex + 1};1H${renderRow(next, rowIndex, theme)}`;
  });
  return `${output}\u001b[0m${renderCursor(next)}`;
};

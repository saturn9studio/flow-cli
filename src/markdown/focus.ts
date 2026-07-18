import type {
  TerminalColor,
  TextStyle,
  WidgetGraphic,
  WidgetRenderer,
  WidgetTextRun,
} from "../engine/index.js";

export interface SentenceRange {
  readonly from: number;
  readonly to: number;
}

export const sentenceRangeAt = (
  text: string,
  offset: number,
): SentenceRange => {
  let from = Math.max(0, Math.min(offset, text.length));
  let to = from;
  while (from > 0) {
    const previous = text[from - 1];
    if (/[.?!]/u.test(previous ?? "") && /\s/u.test(text[from] ?? "")) break;
    from -= 1;
  }
  while (to < text.length) {
    const current = text[to];
    to += 1;
    if (
      /[.?!]/u.test(current ?? "") &&
      (to === text.length || /\s/u.test(text[to] ?? ""))
    ) {
      break;
    }
  }
  return { from, to };
};

interface InactiveWidgetOptions {
  readonly grayscaleColors?: boolean;
  readonly muteGraphic?: boolean;
}

const grayscale = (color: TerminalColor | undefined): TerminalColor | undefined => {
  if (!color || typeof color === "string") return color;
  const luminance = Math.round(
    color.red * 0.299 + color.green * 0.587 + color.blue * 0.114,
  );
  return { red: luminance, green: luminance, blue: luminance };
};

const inactiveStyle = (
  style: TextStyle | undefined,
  grayscaleColors: boolean,
): TextStyle => {
  return {
    ...style,
    ...(grayscaleColors
      ? {
          foreground: grayscale(style?.foreground),
          background: grayscale(style?.background),
        }
      : {}),
    role: "focusInactive",
    dim: true,
  };
};

const mutedGraphic = (graphic: WidgetGraphic): WidgetGraphic => {
  const data = Uint8Array.from(graphic.data);
  for (let offset = 0; offset < data.length; offset += 4) {
    const luminance = Math.round(
      (data[offset] ?? 0) * 0.299 +
        (data[offset + 1] ?? 0) * 0.587 +
        (data[offset + 2] ?? 0) * 0.114,
    );
    data[offset] = luminance;
    data[offset + 1] = luminance;
    data[offset + 2] = luminance;
    data[offset + 3] = Math.round((data[offset + 3] ?? 0) * 0.5);
  }
  return { ...graphic, data };
};

const inactiveLine = (
  line: string | readonly WidgetTextRun[],
  grayscaleColors: boolean,
): readonly WidgetTextRun[] =>
  typeof line === "string"
    ? [{ text: line, style: inactiveStyle(undefined, grayscaleColors) }]
    : line.map((run) => ({
        ...run,
        style: inactiveStyle(run.style, grayscaleColors),
      }));

export const withInactiveFocusStyle = <TProps>(
  renderer: WidgetRenderer<TProps>,
  options: InactiveWidgetOptions = {},
): WidgetRenderer<TProps> => ({
  render(context) {
    const result = renderer.render(context);
    if (context.focused) return result;
    return {
      lines: result.lines.map((line) =>
        inactiveLine(line, options.grayscaleColors ?? false)
      ),
      graphic: result.graphic && options.muteGraphic
        ? mutedGraphic(result.graphic)
        : result.graphic,
    };
  },
  ...(renderer.handleInput
    ? { handleInput: (context) => renderer.handleInput?.(context) ?? false }
    : {}),
});

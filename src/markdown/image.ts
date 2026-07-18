import type {
  NamedTerminalColor,
  RgbColor,
  TerminalColor,
  TextStyle,
  WidgetRenderer,
  WidgetTextRun,
} from "../engine/index.js";

export interface TerminalImageData {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface TerminalImageRenderOptions {
  readonly maxColumns?: number;
  readonly maxRows?: number;
  readonly colorMode?: "truecolor" | "ansi16";
  readonly sampling?: "bilinear" | "nearest";
  readonly dithering?: boolean;
  readonly background?: RgbColor;
}

export interface TerminalImageWidgetProps extends TerminalImageRenderOptions {
  readonly image: TerminalImageData;
  readonly alt: string;
  readonly src: string;
}

const positiveInteger = (value: number | undefined, fallback: number): number =>
  Math.max(1, Math.floor(value ?? fallback));

export const terminalImageFromRgba = (
  width: number,
  height: number,
  rgba: Uint8Array,
): TerminalImageData => {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error("Terminal image dimensions must be positive integers.");
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `Expected ${width * height * 4} RGBA bytes, received ${rgba.length}.`,
    );
  }
  return {
    width,
    height,
    rgba: Uint8Array.from(rgba),
  };
};

interface PaletteColor {
  readonly name: NamedTerminalColor;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const ansiPalette: readonly PaletteColor[] = [
  { name: "black", red: 0, green: 0, blue: 0 },
  { name: "red", red: 170, green: 0, blue: 0 },
  { name: "green", red: 0, green: 170, blue: 0 },
  { name: "yellow", red: 170, green: 85, blue: 0 },
  { name: "blue", red: 0, green: 0, blue: 170 },
  { name: "magenta", red: 170, green: 0, blue: 170 },
  { name: "cyan", red: 0, green: 170, blue: 170 },
  { name: "white", red: 170, green: 170, blue: 170 },
  { name: "brightBlack", red: 85, green: 85, blue: 85 },
  { name: "brightRed", red: 255, green: 85, blue: 85 },
  { name: "brightGreen", red: 85, green: 255, blue: 85 },
  { name: "brightYellow", red: 255, green: 255, blue: 85 },
  { name: "brightBlue", red: 85, green: 85, blue: 255 },
  { name: "brightMagenta", red: 255, green: 85, blue: 255 },
  { name: "brightCyan", red: 85, green: 255, blue: 255 },
  { name: "brightWhite", red: 255, green: 255, blue: 255 },
];

interface SampledColor {
  readonly color?: TerminalColor;
  readonly transparent: boolean;
}

const pixelOffset = (image: TerminalImageData, x: number, y: number): number =>
  (y * image.width + x) * 4;

const nearestPaletteColor = (
  red: number,
  green: number,
  blue: number,
): NamedTerminalColor => {
  let nearest = ansiPalette[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of ansiPalette) {
    const redMean = (candidate.red + red) / 2;
    const nextDistance =
      (2 + redMean / 256) * (candidate.red - red) ** 2 +
      4 * (candidate.green - green) ** 2 +
      (2 + (255 - redMean) / 256) * (candidate.blue - blue) ** 2;
    if (nextDistance < distance) {
      nearest = candidate;
      distance = nextDistance;
    }
  }
  return nearest.name;
};

interface RgbaSample extends RgbColor {
  readonly alpha: number;
}

const sourcePixel = (
  image: TerminalImageData,
  x: number,
  y: number,
): RgbaSample => {
  const sourceX = Math.max(0, Math.min(image.width - 1, x));
  const sourceY = Math.max(0, Math.min(image.height - 1, y));
  const offset = pixelOffset(image, sourceX, sourceY);
  return {
    red: image.rgba[offset] ?? 0,
    green: image.rgba[offset + 1] ?? 0,
    blue: image.rgba[offset + 2] ?? 0,
    alpha: image.rgba[offset + 3] ?? 0,
  };
};

const bilinearPixel = (
  image: TerminalImageData,
  x: number,
  y: number,
): RgbaSample => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const xWeight = x - x0;
  const yWeight = y - y0;
  const samples = [
    [sourcePixel(image, x0, y0), (1 - xWeight) * (1 - yWeight)],
    [sourcePixel(image, x1, y0), xWeight * (1 - yWeight)],
    [sourcePixel(image, x0, y1), (1 - xWeight) * yWeight],
    [sourcePixel(image, x1, y1), xWeight * yWeight],
  ] as const;
  const channel = (key: keyof RgbaSample): number =>
    samples.reduce((sum, [pixel, weight]) => sum + pixel[key] * weight, 0);
  return {
    red: channel("red"),
    green: channel("green"),
    blue: channel("blue"),
    alpha: channel("alpha"),
  };
};

const bayer = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const sample = (
  image: TerminalImageData,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  options: TerminalImageRenderOptions,
): SampledColor => {
  const sourceX = (targetX + 0.5) * image.width / targetWidth - 0.5;
  const sourceY = (targetY + 0.5) * image.height / targetHeight - 0.5;
  const pixel = options.sampling === "nearest"
    ? sourcePixel(image, Math.round(sourceX), Math.round(sourceY))
    : bilinearPixel(image, sourceX, sourceY);
  if (pixel.alpha < 16) return { transparent: true };
  const alpha = pixel.alpha / 255;
  const background = options.background ?? { red: 0, green: 0, blue: 0 };
  const composite = (foreground: number, behind: number): number =>
    Math.round(foreground * alpha + behind * (1 - alpha));
  const ditherOffset = options.dithering
    ? ((bayer[targetY % 4]?.[targetX % 4] ?? 8) - 7.5) * 4
    : 0;
  const red = composite(pixel.red, background.red) + ditherOffset;
  const green = composite(pixel.green, background.green) + ditherOffset;
  const blue = composite(pixel.blue, background.blue) + ditherOffset;
  return {
    transparent: false,
    color: options.colorMode === "ansi16"
      ? nearestPaletteColor(red, green, blue)
      : { red, green, blue },
  };
};

const sameColor = (
  a: TerminalColor | undefined,
  b: TerminalColor | undefined,
): boolean =>
  typeof a === "object" && typeof b === "object"
    ? a.red === b.red && a.green === b.green && a.blue === b.blue
    : a === b;

const sameStyle = (a: TextStyle | undefined, b: TextStyle | undefined): boolean =>
  sameColor(a?.foreground, b?.foreground) &&
  sameColor(a?.background, b?.background);

const appendRun = (
  runs: WidgetTextRun[],
  text: string,
  style?: TextStyle,
): void => {
  const previous = runs.at(-1);
  if (previous && sameStyle(previous.style, style)) {
    runs[runs.length - 1] = { text: `${previous.text}${text}`, style };
  } else {
    runs.push({ text, style });
  }
};

const halfBlock = (
  top: SampledColor,
  bottom: SampledColor,
): { readonly text: string; readonly style?: TextStyle } => {
  if (top.transparent && bottom.transparent) return { text: " " };
  if (top.transparent) {
    return { text: "▄", style: { foreground: bottom.color } };
  }
  if (bottom.transparent) {
    return { text: "▀", style: { foreground: top.color } };
  }
  if (sameColor(top.color, bottom.color)) {
    return { text: "█", style: { foreground: top.color } };
  }
  return {
    text: "▀",
    style: { foreground: top.color, background: bottom.color },
  };
};

export const renderTerminalImage = (
  image: TerminalImageData,
  availableWidth: number,
  options: TerminalImageRenderOptions = {},
): readonly (readonly WidgetTextRun[])[] => {
  const renderOptions: TerminalImageRenderOptions = {
    colorMode: "truecolor",
    sampling: "bilinear",
    ...options,
  };
  const widthLimit = Math.min(
    positiveInteger(availableWidth, 1),
    positiveInteger(renderOptions.maxColumns, availableWidth),
  );
  const rowLimit = positiveInteger(renderOptions.maxRows, 40);
  const widthForRowLimit = Math.max(
    1,
    Math.floor(rowLimit * 2 * image.width / image.height),
  );
  const columns = Math.min(widthLimit, widthForRowLimit);
  const naturalRows = Math.max(
    1,
    Math.ceil(image.height * columns / image.width / 2),
  );
  const rows = Math.min(naturalRows, rowLimit);
  const targetPixelHeight = rows * 2;
  const lines: WidgetTextRun[][] = [];

  for (let row = 0; row < rows; row += 1) {
    const runs: WidgetTextRun[] = [];
    for (let column = 0; column < columns; column += 1) {
      const top = sample(
        image,
        column,
        row * 2,
        columns,
        targetPixelHeight,
        renderOptions,
      );
      const bottom = sample(
        image,
        column,
        row * 2 + 1,
        columns,
        targetPixelHeight,
        renderOptions,
      );
      const cell = halfBlock(top, bottom);
      appendRun(runs, cell.text, cell.style);
    }
    lines.push(runs);
  }
  return lines;
};

export const terminalImageWidgetRenderer: WidgetRenderer<TerminalImageWidgetProps> = {
  render({ props, width }) {
    return {
      lines: renderTerminalImage(props.image, width, props),
      graphic: {
        format: "rgba",
        width: props.image.width,
        height: props.image.height,
        data: props.image.rgba,
      },
    };
  },
};

import { Jimp } from "jimp";
import { terminalImageFromRgba, type TerminalImageData } from "./image.js";

export * from "./image.js";

export interface DecodeTerminalImageOptions {
  readonly maxPixelWidth?: number;
  readonly maxPixelHeight?: number;
}

const positiveInteger = (value: number | undefined, fallback: number): number =>
  Math.max(1, Math.floor(value ?? fallback));

export const decodeTerminalImage = async (
  input: Uint8Array | ArrayBuffer,
  options: DecodeTerminalImageOptions = {},
): Promise<TerminalImageData> => {
  const encoded = input instanceof Uint8Array
    ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
    : input;
  const image = await Jimp.read(encoded);
  const maxPixelWidth = positiveInteger(options.maxPixelWidth, 160);
  const maxPixelHeight = positiveInteger(options.maxPixelHeight, 160);
  if (image.bitmap.width > maxPixelWidth || image.bitmap.height > maxPixelHeight) {
    image.scaleToFit({ w: maxPixelWidth, h: maxPixelHeight });
  }
  return terminalImageFromRgba(
    image.bitmap.width,
    image.bitmap.height,
    image.bitmap.data,
  );
};
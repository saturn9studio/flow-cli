import { deflateSync } from "node:zlib";
import type { FrameGraphic } from "./frame.js";

export type NativeGraphicsProtocol = "kitty" | "iterm2";

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (type: Buffer, data: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, data])) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeBytes, data));
  return Buffer.concat([length, typeBytes, data, checksum]);
};

export const rgbaToPng = (
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array => {
  if (rgba.length !== width * height * 4) {
    throw new Error("RGBA data does not match the supplied image dimensions.");
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    Buffer.from(rgba).copy(
      scanlines,
      row * (width * 4 + 1) + 1,
      row * width * 4,
      (row + 1) * width * 4,
    );
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

export const graphicId = (key: string): number => {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(key)) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return (hash >>> 0) || 1;
};

const at = (graphic: FrameGraphic): string =>
  `\u001b[${graphic.row + 1};${graphic.column + 1}H`;

export const deleteKittyGraphic = (id: number): string =>
  `\u001b_Ga=d,d=i,i=${id},q=2\u001b\\`;

export const renderKittyGraphic = (graphic: FrameGraphic): string => {
  const payload = Buffer.from(graphic.image.data).toString("base64");
  const chunks = payload.match(/.{1,4096}/g) ?? [""];
  return `${at(graphic)}${chunks.map((chunk, index) => {
    const more = index < chunks.length - 1 ? 1 : 0;
    const control = index === 0
      ? `a=T,f=32,s=${graphic.image.width},v=${graphic.image.height},c=${graphic.columns},r=${graphic.rows},i=${graphicId(graphic.key)},q=2,C=1,m=${more}`
      : `m=${more}`;
    return `\u001b_G${control};${chunk}\u001b\\`;
  }).join("")}`;
};

export const renderIterm2Graphic = (graphic: FrameGraphic): string => {
  const png = rgbaToPng(
    graphic.image.width,
    graphic.image.height,
    graphic.image.data,
  );
  const name = Buffer.from(graphic.key).toString("base64");
  return `${at(graphic)}\u001b]1337;File=name=${name};size=${png.length};width=${
    graphic.columns
  };height=${graphic.rows};preserveAspectRatio=1;inline=1;doNotMoveCursor=1:${
    Buffer.from(png).toString("base64")
  }\u0007`;
};

export const detectNativeGraphicsProtocol = (
  environment: Readonly<Record<string, string | undefined>>,
): NativeGraphicsProtocol | undefined => {
  if (environment.KITTY_WINDOW_ID || environment.TERM?.includes("kitty")) {
    return "kitty";
  }
  if (
    environment.TERM_PROGRAM === "iTerm.app" ||
    environment.TERM_PROGRAM === "WezTerm"
  ) {
    return "iterm2";
  }
  return undefined;
};

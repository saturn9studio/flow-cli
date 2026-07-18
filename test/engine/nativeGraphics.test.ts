import { describe, expect, it } from "vitest";
import {
  detectNativeGraphicsProtocol,
  renderKittyGraphic,
  renderIterm2Graphic,
  rgbaToPng,
} from "../../src/engine/nativeGraphics.js";
import type { FrameGraphic } from "../../src/engine/frame.js";

const graphic: FrameGraphic = {
  key: "test:image",
  row: 1,
  column: 2,
  columns: 4,
  rows: 3,
  image: {
    format: "rgba",
    width: 1,
    height: 1,
    data: Uint8Array.from([255, 0, 0, 255]),
  },
};

describe("native terminal graphics", () => {
  it("encodes RGBA pixels as PNG for file-based protocols", () => {
    const png = rgbaToPng(1, 1, graphic.image.data);
    expect(Buffer.from(png.subarray(0, 8)).toString("hex"))
      .toBe("89504e470d0a1a0a");
    expect(Buffer.from(png).includes(Buffer.from("IEND"))).toBe(true);
  });

  it("encodes iTerm2 placement without moving the editor cursor", () => {
    const output = renderIterm2Graphic(graphic);
    expect(output).toContain("\u001b[2;3H\u001b]1337;File=");
    expect(output).toContain("width=4;height=3");
    expect(output).toContain("doNotMoveCursor=1");
  });

  it("places Kitty graphics without moving the terminal cursor", () => {
    expect(renderKittyGraphic(graphic)).toContain(",C=1,");
  });

  it("detects supported terminal protocols conservatively", () => {
    expect(detectNativeGraphicsProtocol({ KITTY_WINDOW_ID: "1" })).toBe("kitty");
    expect(detectNativeGraphicsProtocol({ TERM_PROGRAM: "iTerm.app" })).toBe("iterm2");
    expect(detectNativeGraphicsProtocol({ TERM: "xterm-256color" })).toBeUndefined();
  });
});

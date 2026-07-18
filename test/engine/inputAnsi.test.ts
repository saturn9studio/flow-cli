import { describe, expect, it } from "vitest";
import {
  TerminalInputDecoder,
  cursorStyleToAnsi,
  diffFrames,
  frameToAnsi,
  type Frame,
  type TerminalTheme,
} from "../../src/engine/index.js";

describe("terminal input", () => {
  it("decodes keys, text, and bracketed paste", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("a\u001b[D\t\u001b[Z")).toEqual([
      { kind: "text", text: "a" },
      { kind: "key", key: "ArrowLeft" },
      { kind: "key", key: "Tab" },
      { kind: "key", key: "Tab", shift: true },
    ]);
    expect(decoder.push("\u001b[200~one\ntwo\u001b[201~")).toEqual([
      { kind: "paste", text: "one\ntwo" },
    ]);
  });

  it("buffers a split bracketed paste", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("\u001b[200~hel")).toEqual([]);
    expect(decoder.push("lo\u001b[201~")).toEqual([
      { kind: "paste", text: "hello" },
    ]);
  });

  it("decodes SGR mouse presses, drags, releases, modifiers, and wheel events", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push(
      "\u001b[<0;3;2M\u001b[<32;5;2M\u001b[<0;5;2m\u001b[<30;7;4M\u001b[<64;1;1M",
    )).toEqual([
      { kind: "mouse", action: "press", button: "left", column: 2, row: 1 },
      { kind: "mouse", action: "move", button: "left", column: 4, row: 1 },
      { kind: "mouse", action: "release", button: "left", column: 4, row: 1 },
      {
        kind: "mouse",
        action: "press",
        button: "right",
        column: 6,
        row: 3,
        shift: true,
        alt: true,
        ctrl: true,
      },
      { kind: "mouse", action: "wheel", button: "wheelUp", column: 0, row: 0 },
    ]);
  });

  it("buffers a split SGR mouse sequence", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("\u001b[<0;12")).toEqual([]);
    expect(decoder.push(";4M")).toEqual([
      { kind: "mouse", action: "press", button: "left", column: 11, row: 3 },
    ]);
  });

  it("decodes modern modified-key protocols", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push(
      "\u001b[97;6u\u001b[99;9u\u001b[27;3;120~\u001b[1;6D\u001b[127;5:3u\u001b[57376;1u",
    )).toEqual([
      { kind: "key", key: "a", ctrl: true, shift: true },
      { kind: "key", key: "c", meta: true },
      { kind: "key", key: "x", alt: true },
      { kind: "key", key: "ArrowLeft", ctrl: true, shift: true },
      { kind: "key", key: "Backspace", ctrl: true, action: "release" },
      { kind: "key", key: "F13" },
    ]);
  });

  it("buffers incomplete modified-key sequences", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("\u001b[1;")).toEqual([]);
    expect(decoder.push("5D")).toEqual([
      { kind: "key", key: "ArrowLeft", ctrl: true },
    ]);
  });

  it("decodes legacy SS3 and CSI function keys", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push(
      "\u001bOP\u001bOQ\u001bOR\u001bOS" +
        "\u001b[15~\u001b[17~\u001b[18~\u001b[19~" +
        "\u001b[20~\u001b[21~\u001b[23~\u001b[24~",
    )).toEqual(
      Array.from({ length: 12 }, (_value, index) => ({
        kind: "key",
        key: `F${index + 1}`,
      })),
    );
    expect(decoder.push(
      "\u001b[11~\u001b[12~\u001b[13~\u001b[14~",
    )).toEqual([
      { kind: "key", key: "F1" },
      { kind: "key", key: "F2" },
      { kind: "key", key: "F3" },
      { kind: "key", key: "F4" },
    ]);
  });
});

describe("ANSI rendering", () => {
  it("encodes portable cursor shapes and blinking variants", () => {
    expect(cursorStyleToAnsi()).toBe("\u001b[0 q");
    expect(cursorStyleToAnsi({ shape: "block" })).toBe("\u001b[1 q");
    expect(cursorStyleToAnsi({ shape: "block", blinking: false })).toBe("\u001b[2 q");
    expect(cursorStyleToAnsi({ shape: "underline" })).toBe("\u001b[3 q");
    expect(cursorStyleToAnsi({ shape: "underline", blinking: false })).toBe("\u001b[4 q");
    expect(cursorStyleToAnsi({ shape: "bar" })).toBe("\u001b[5 q");
    expect(cursorStyleToAnsi({ shape: "bar", blinking: false })).toBe("\u001b[6 q");
  });

  it("renders rich text styles without leaking attributes between runs", () => {
    const frame: Frame = {
      width: 5,
      height: 1,
      rows: [
        {
          cells: [
            { text: "A", style: { bold: true } },
            { text: "B", style: { italic: true } },
            { text: "C", style: { underline: true } },
            { text: "D", style: { strikethrough: true } },
            { text: "E", style: {} },
          ],
        },
      ],
      cursor: { row: 0, column: 5, visible: true },
    };
    const output = frameToAnsi(frame);
    expect(output).toContain(
      "\u001b[0;1mA\u001b[0;3mB\u001b[0;4mC\u001b[0;9mD\u001b[0mE",
    );
    expect(output).toContain("\u001b[1;6H\u001b[?25h");
  });

  it("does not emit document control characters", () => {
    const frame: Frame = {
      width: 1,
      height: 1,
      rows: [{ cells: [{ text: "␛", style: {} }] }],
      cursor: { row: 0, column: 0, visible: false },
    };
    expect(frameToAnsi(frame)).toContain("␛");
  });

  it("resets a full-width styled row before rendering the next row", () => {
    const frame: Frame = {
      width: 3,
      height: 2,
      rows: [
        { cells: "abc".split("").map((text) => ({ text, style: { foreground: "red" as const } })) },
        { cells: "xyz".split("").map((text) => ({ text, style: {} })) },
      ],
      cursor: { row: 0, column: 0, visible: false },
    };
    expect(frameToAnsi(frame)).toContain("\u001b[0;31mabc\u001b[0m\r\nxyz");
  });

  it("applies a caller-provided theme during frame diffing", () => {
    const theme: TerminalTheme = {
      name: "Test",
      roles: { body: { foreground: "brightGreen" } },
    };
    const frame: Frame = {
      width: 1,
      height: 1,
      rows: [{ cells: [{ text: "A", style: { role: "body" } }] }],
      cursor: { row: 0, column: 0, visible: true },
    };
    expect(diffFrames(null, frame, { theme })).toContain("\u001b[0;92mA");
  });

  it("resolves a semantic line background independently of the foreground role", () => {
    const theme: TerminalTheme = {
      name: "Test",
      roles: {
        quote: { background: "red" },
        selection: { inverse: true },
      },
    };
    const frame: Frame = {
      width: 1,
      height: 1,
      rows: [{
        cells: [{
          text: "A",
          style: { role: "selection", backgroundRole: "quote" },
        }],
      }],
      cursor: { row: 0, column: 0, visible: false },
    };

    expect(frameToAnsi(frame, { theme })).toContain("\u001b[0;7;41mA");
  });

  it("lets an inline role background override its line background", () => {
    const theme: TerminalTheme = {
      name: "Test",
      roles: {
        quote: { background: "red" },
        active: { background: "blue" },
      },
    };
    const frame: Frame = {
      width: 1,
      height: 1,
      rows: [{
        cells: [{
          text: "A",
          style: { role: "active", backgroundRole: "quote" },
        }],
      }],
      cursor: { row: 0, column: 0, visible: false },
    };

    expect(frameToAnsi(frame, { theme })).toContain("\u001b[0;44mA");
  });

  it("redraws only changed rows when diffing equal-sized frames", () => {
    const previous: Frame = {
      width: 2,
      height: 2,
      rows: [
        { cells: [{ text: "A", style: {} }] },
        { cells: [{ text: "B", style: {} }] },
      ],
      cursor: { row: 0, column: 0, visible: true },
    };
    const next: Frame = {
      ...previous,
      rows: [
        previous.rows[0],
        { cells: [{ text: "C", style: {} }] },
      ],
      cursor: { row: 1, column: 0, visible: true },
    };
    const output = diffFrames(previous, next);
    expect(output).toContain("\u001b[2;1HC ");
    expect(output).not.toContain("\u001b[H");
    expect(output).not.toContain("A");
  });

  it("renders safe named colors supplied by data-driven text runs", () => {
    const frame: Frame = {
      width: 1,
      height: 1,
      rows: [{
        cells: [{
          text: "▀",
          style: { foreground: "brightRed", background: "blue" },
        }],
      }],
      cursor: { row: 0, column: 0, visible: false },
    };

    expect(frameToAnsi(frame)).toContain("\u001b[0;91;44m▀");
  });

  it("renders clamped truecolor styles", () => {
    const frame: Frame = {
      width: 1,
      height: 1,
      rows: [{
        cells: [{
          text: "▀",
          style: {
            foreground: { red: 260, green: 64.4, blue: -1 },
            background: { red: 0, green: 128, blue: 255 },
          },
        }],
      }],
      cursor: { row: 0, column: 0, visible: false },
    };
    expect(frameToAnsi(frame)).toContain(
      "\u001b[0;38;2;255;64;0;48;2;0;128;255m▀",
    );
  });

  it("resets image backgrounds before padding a short row", () => {
    const frame: Frame = {
      width: 4,
      height: 2,
      rows: [
        {
          cells: [{
            text: "▀",
            style: { foreground: "brightRed", background: "blue" },
          }],
        },
        { cells: [] },
      ],
      cursor: { row: 1, column: 0, visible: false },
    };

    expect(frameToAnsi(frame)).toContain(
      "\u001b[0;91;44m▀\u001b[0m   \r\n    ",
    );
  });
});

import { EventEmitter } from "node:events";
import type { ReadStream, WriteStream } from "node:tty";
import { describe, expect, it, vi } from "vitest";
import {
  PluginId,
  TerminalEditor,
  type EditorPlugin,
  type TerminalCursorStyle,
} from "../../src/engine/index.js";
import {
  detectTerminalKeyboardProtocol,
  NodeTerminalHost,
} from "../../src/engine/node.js";

const createStreams = () => {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    setEncoding: vi.fn(),
  }) as unknown as ReadStream;
  const stdout = Object.assign(new EventEmitter(), {
    isTTY: true,
    columns: 80,
    rows: 24,
    write: vi.fn(() => true),
  }) as unknown as WriteStream;
  return { stdin, stdout };
};

describe("Node terminal cursor lifecycle", () => {
  it("auto-detects terminals with extended keyboard reporting", () => {
    expect(detectTerminalKeyboardProtocol({ TERM_PROGRAM: "WezTerm" }))
      .toBe("kitty");
    expect(detectTerminalKeyboardProtocol({ TERM: "xterm-ghostty" }))
      .toBe("kitty");
    expect(detectTerminalKeyboardProtocol({ TERM_PROGRAM: "Apple_Terminal" }))
      .toBe("legacy");
  });

  it("enables auto-detected extended keyboard reporting", () => {
    const { stdin, stdout } = createStreams();
    const editor = new TerminalEditor({ content: "text" });
    const host = new NodeTerminalHost(editor, {
      stdin,
      stdout,
      keyboardProtocol: "auto",
      environment: { TERM_PROGRAM: "WezTerm" },
    });

    host.start();
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b[>1u"),
    );
    host.stop();
    expect(stdout.write).toHaveBeenLastCalledWith(
      expect.stringContaining("\u001b[<u"),
    );
  });

  it("applies a custom cursor and restores the terminal default on stop", () => {
    const { stdin, stdout } = createStreams();
    const editor = new TerminalEditor({ content: "text" });
    const host = new NodeTerminalHost(editor, {
      stdin,
      stdout,
      cursor: { shape: "bar", blinking: false },
      keyboardProtocol: "kitty",
    });

    host.start();
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b[6 q"),
    );
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b[?1002h\u001b[?1006h"),
    );
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b[>1u"),
    );

    host.stop();
    expect(stdout.write).toHaveBeenLastCalledWith(
      expect.stringContaining("\u001b[0 q"),
    );
    expect(stdout.write).toHaveBeenLastCalledWith(
      expect.stringContaining("\u001b[?1006l\u001b[?1002l"),
    );
    expect(stdout.write).toHaveBeenLastCalledWith(
      expect.stringContaining("\u001b[<u"),
    );
    expect(stdin.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("updates a dynamic cursor style", () => {
    const { stdin, stdout } = createStreams();
    const editor = new TerminalEditor({ content: "text" });
    let cursor: TerminalCursorStyle = { shape: "block", blinking: true };
    const host = new NodeTerminalHost(editor, {
      stdin,
      stdout,
      cursor: () => cursor,
    });

    host.start();
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b[1 q"),
    );
    vi.mocked(stdout.write).mockClear();

    cursor = { shape: "bar", blinking: false };
    editor.invalidatePresentation();

    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b[6 q"),
    );
    host.stop();
  });

  it("routes Escape to the editor instead of exiting the host", () => {
    const { stdin, stdout } = createStreams();
    const editor = new TerminalEditor({ content: "text" });
    const host = new NodeTerminalHost(editor, { stdin, stdout });
    host.start();
    stdin.emit("data", "\u001b");
    expect(stdin.setRawMode).toHaveBeenCalledTimes(1);
    host.stop();
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("lets an application surface defer an exit request", () => {
    const { stdin, stdout } = createStreams();
    const editor = new TerminalEditor({ content: "text" });
    const onExitRequest = vi.fn(() => false);
    const host = new NodeTerminalHost(editor, {
      stdin,
      stdout,
      onExitRequest,
    });
    host.start();

    stdin.emit("data", "\u0011");

    expect(onExitRequest).toHaveBeenCalledOnce();
    expect(stdin.setRawMode).not.toHaveBeenCalledWith(false);
    host.stop();
  });

  it("keeps input bundled after a deferred exit request", () => {
    const { stdin, stdout } = createStreams();
    const editor = new TerminalEditor({ content: "" });
    const host = new NodeTerminalHost(editor, {
      stdin,
      stdout,
      onExitRequest: () => false,
    });
    host.start();

    stdin.emit("data", "\u0011hi");

    expect(editor.snapshot().content).toBe("hi");
    host.stop();
  });

  it("can leave Ctrl+C input to an application surface", () => {
    const { stdin, stdout } = createStreams();
    const editor = new TerminalEditor({ content: "text" });
    const handleInput = vi.spyOn(editor, "handleInput");
    const host = new NodeTerminalHost(editor, {
      stdin,
      stdout,
      ctrlCExits: false,
    });
    host.start();

    stdin.emit("data", "\u0003");

    expect(handleInput).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "key", key: "c", ctrl: true }),
      { width: 80, height: 24 },
    );
    host.stop();
  });

  it("redraws an unchanged frame when a dynamic theme changes", () => {
    const { stdin, stdout } = createStreams();
    const editor = new TerminalEditor({ content: "text" });
    let foreground: "red" | "blue" = "red";
    let cursor = { red: 255, green: 0, blue: 128 };
    const host = new NodeTerminalHost(editor, {
      stdin,
      stdout,
      theme: () => ({
        name: "dynamic",
        cursor,
        roles: { text: { foreground } },
      }),
    });
    host.start();
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b]12;rgb:ff/00/80\u001b\\"),
    );
    vi.mocked(stdout.write).mockClear();

    foreground = "blue";
    cursor = { red: 0, green: 128, blue: 255 };
    editor.invalidatePresentation();

    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b]12;rgb:00/80/ff\u001b\\"),
    );
    host.stop();
    expect(stdout.write).toHaveBeenLastCalledWith(
      expect.stringContaining("\u001b]112\u001b\\"),
    );
  });

  it("places and deletes Kitty graphics owned by block widgets", () => {
    const { stdin, stdout } = createStreams();
    let pixels = Uint8Array.from([255, 0, 0, 255]);
    const plugin: EditorPlugin<null> = {
      id: new PluginId("test.graphics"),
      init: () => null,
      apply: () => null,
      widgets: () => [{
        key: "test:image",
        placement: "block",
        range: {
          from: { paragraph: 0, offset: 0 },
          to: { paragraph: 0, offset: 5 },
        },
        props: {},
        selection: "block",
        render: {
          render: () => ({
            lines: [" "],
            graphic: {
              format: "rgba",
              width: 1,
              height: 1,
              data: pixels,
            },
          }),
        },
      }],
    };
    const editor = new TerminalEditor({
      content: "image",
      plugins: [plugin as EditorPlugin<unknown>],
    });
    const host = new NodeTerminalHost(editor, {
      stdin,
      stdout,
      graphicsProtocol: "kitty",
    });

    host.start();
    expect(stdout.write).toHaveBeenCalledWith(
      expect.stringContaining("\u001b_Ga=T,f=32"),
    );
    pixels = Uint8Array.from([0, 0, 255, 255]);
    editor.invalidatePresentation();
    expect(stdout.write).toHaveBeenLastCalledWith(
      expect.stringMatching(/\u001b_Ga=d,d=i.*\u001b_Ga=T,f=32/s),
    );
    host.stop();
    expect(stdout.write).toHaveBeenLastCalledWith(
      expect.stringContaining("\u001b_Ga=d,d=i"),
    );
  });
});
import { describe, expect, it, vi } from "vitest";
import {
  PluginId,
  TerminalEditor,
  editorCommandNames,
  keyBindingMatches,
  type EditorPlugin,
} from "../../src/engine/index.js";

describe("commands and keymaps", () => {
  it("matches modifier aliases exactly", () => {
    const event = { kind: "key", key: "a", meta: true } as const;
    expect(keyBindingMatches(event, { key: "Mod+A", command: "select" })).toBe(true);
    expect(keyBindingMatches(event, { key: "Command+A", command: "select" })).toBe(true);
    expect(keyBindingMatches(event, { key: "Ctrl+A", command: "select" })).toBe(false);
    expect(keyBindingMatches(
      { kind: "key", key: "ArrowLeft", alt: true },
      { key: "Option+ArrowLeft", command: "word" },
    )).toBe(true);
  });

  it("supports selection, word/document movement, and word deletion", () => {
    const editor = new TerminalEditor({ content: "one two\nthree" });
    expect(editor.execute(editorCommandNames.selectAll)).toBe(true);
    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 1, offset: 5 },
    });

    editor.execute(editorCommandNames.moveLeft);
    expect(editor.snapshot().selection.head).toEqual({ paragraph: 0, offset: 0 });
    editor.execute(editorCommandNames.moveWordRight);
    expect(editor.snapshot().selection.head).toEqual({ paragraph: 0, offset: 3 });
    editor.execute(editorCommandNames.moveWordRightExtend);
    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 3 },
      head: { paragraph: 0, offset: 7 },
    });
    editor.execute(editorCommandNames.moveDocumentEnd);
    editor.execute(editorCommandNames.deleteWordBackward);
    expect(editor.snapshot().content).toBe("one two\n");
  });

  it("uses visual wrapped-line boundaries", () => {
    const editor = new TerminalEditor({ content: "abcdef" });
    editor.execute(editorCommandNames.moveLineEnd, { width: 3, height: 2 });
    expect(editor.snapshot().selection.head).toEqual({ paragraph: 0, offset: 3 });
    editor.execute(editorCommandNames.moveLineEnd, { width: 3, height: 2 });
    expect(editor.snapshot().selection.head).toEqual({ paragraph: 0, offset: 3 });
    editor.execute(editorCommandNames.moveRight);
    editor.execute(editorCommandNames.moveLineEnd, { width: 3, height: 2 });
    expect(editor.snapshot().selection.head).toEqual({ paragraph: 0, offset: 6 });
  });

  it("resolves app keymaps, plugin keymaps, plugin input, then defaults", () => {
    const order: string[] = [];
    const plugin: EditorPlugin<null> = {
      id: new PluginId("order"),
      init: () => null,
      apply: ({ state }) => state,
      keymap: [{ key: "Ctrl+K", command: "plugin.command" }],
      commands: () => [{
        name: "plugin.command",
        run: () => {
          order.push("plugin-keymap");
          return true;
        },
      }],
      handleInput: ({ event }) => {
        if (event.kind === "key") order.push("plugin-input");
        return false;
      },
    };
    const appCommand = vi.fn(() => true);
    const editor = new TerminalEditor({
      content: "text",
      plugins: [plugin],
      commands: [{ name: "app.command", run: appCommand }],
      keymap: [{ key: "Ctrl+J", command: "app.command" }],
    });

    editor.handleInput({ kind: "key", key: "j", ctrl: true });
    expect(appCommand).toHaveBeenCalledOnce();
    expect(order).toEqual([]);

    editor.handleInput({ kind: "key", key: "k", ctrl: true });
    expect(order).toEqual(["plugin-keymap"]);

    editor.handleInput({ kind: "key", key: "ArrowRight" });
    expect(order).toEqual(["plugin-keymap", "plugin-input"]);
    expect(editor.snapshot().selection.head).toEqual({ paragraph: 0, offset: 1 });
  });
});

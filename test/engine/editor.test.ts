import { describe, expect, it, vi } from "vitest";
import {
  PluginId,
  TerminalEditor,
  StaleTransactionError,
  type EditorPlugin,
} from "../../src/engine/index.js";

describe("TerminalEditor", () => {
  it("edits, batches typing, and restores history", () => {
    const editor = new TerminalEditor();
    editor.handleInput({ kind: "text", text: "a" });
    editor.handleInput({ kind: "text", text: "b" });
    expect(editor.snapshot().content).toBe("ab");

    expect(editor.execute("editor.undo")).toBe(true);
    expect(editor.snapshot().content).toBe("");
    expect(editor.execute("editor.redo")).toBe(true);
    expect(editor.snapshot().content).toBe("ab");
  });

  it("places the cursor on a trailing empty paragraph after Enter", () => {
    const editor = new TerminalEditor({ content: "abc" });
    editor.execute("editor.moveDocumentEnd");

    editor.handleInput(
      { kind: "key", key: "Enter" },
      { width: 20, height: 2 },
    );

    expect(editor.snapshot().selection.head).toEqual({
      paragraph: 1,
      offset: 0,
    });
    expect(editor.frame(20, 2).cursor).toEqual({
      row: 1,
      column: 0,
      visible: true,
    });
  });

  it("rejects a transaction created from stale state", () => {
    const editor = new TerminalEditor({ content: "one" });
    const stale = editor.createTransaction().replaceSelection("A").build();
    editor.handleInput({ kind: "text", text: "B" });
    expect(() => editor.dispatch(stale)).toThrow(StaleTransactionError);
  });

  it("updates isolated plugin state and derives output", () => {
    const id = new PluginId<number>("counter");
    const plugin: EditorPlugin<number> = {
      id,
      init: () => 0,
      apply: ({ state, transaction }) =>
        state + (transaction.displayChanges.length > 0 ? 1 : 0),
      decorations: ({ state }) =>
        state > 0
          ? [{ kind: "inline", from: 0, to: 1, style: { bold: true } }]
          : [],
    };
    const editor = new TerminalEditor({ plugins: [plugin] });
    editor.handleInput({ kind: "text", text: "x" });
    expect(editor.output().decorations).toEqual([
      { kind: "inline", from: 0, to: 1, style: { bold: true } },
    ]);
  });

  it("resets history and plugin state when replacing content", () => {
    const id = new PluginId<number>("content-length");
    const init = vi.fn(({ content }) => content.length);
    const apply = vi.fn(({ content }) => content.length);
    const editor = new TerminalEditor({
      content: "old",
      plugins: [{
        id,
        init,
        apply,
      }],
    });

    editor.handleInput({ kind: "text", text: "!" });
    expect(editor.snapshot().canUndo).toBe(true);
    expect(editor.getPluginState(id)).toBe(4);

    editor.setContent("new words");

    expect(editor.snapshot()).toMatchObject({
      content: "new words",
      canUndo: false,
      canRedo: false,
    });
    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 0 },
    });
    expect(editor.getPluginState(id)).toBe(9);
    expect(init).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("caches unchanged layouts across frame and viewport queries", () => {
    const decorations = vi.fn(() => []);
    const plugin: EditorPlugin<null> = {
      id: new PluginId("layout-cache"),
      init: () => null,
      apply: ({ state }) => state,
      decorations,
    };
    const editor = new TerminalEditor({ content: "cached", plugins: [plugin] });
    editor.frame(20, 2);
    editor.frame(20, 2);
    editor.scrollState({ width: 20, height: 2 });
    editor.output();
    editor.output();
    expect(decorations).toHaveBeenCalledOnce();

    editor.handleInput({ kind: "key", key: "ArrowRight" }, { width: 20, height: 2 });
    editor.frame(20, 2);
    expect(decorations).toHaveBeenCalledTimes(2);
  });

  it("does not mutate read-only content", () => {
    const editor = new TerminalEditor({ content: "safe", readOnly: true });
    expect(editor.handleInput({ kind: "text", text: "!" })).toBe(true);
    expect(editor.snapshot().content).toBe("safe");
    expect(editor.frame(10, 2).cursor.visible).toBe(false);
  });

  it("updates read-only state at runtime", () => {
    const editor = new TerminalEditor({ content: "safe" });
    editor.setReadOnly(true);
    expect(editor.snapshot().readOnly).toBe(true);
    expect(editor.handleInput({ kind: "text", text: "!" })).toBe(true);
    expect(editor.snapshot().content).toBe("safe");
    editor.setReadOnly(false);
    editor.handleInput({ kind: "text", text: "!" });
    expect(editor.snapshot().content).toBe("!safe");
  });

  it("reconfigures plugins while preserving state by id", () => {
    const retainedId = new PluginId<number>("retained");
    const addedId = new PluginId<string>("added");
    const removed = vi.fn();
    const replacementInit = vi.fn(() => 100);
    const retained: EditorPlugin<number> = {
      id: retainedId,
      init: () => 0,
      apply: ({ state, transaction }) =>
        state + (transaction.displayChanges.length > 0 ? 1 : 0),
      destroy: removed,
    };
    const replacement: EditorPlugin<number> = {
      id: retainedId,
      init: replacementInit,
      apply: ({ state }) => state,
      destroy: removed,
    };
    const added: EditorPlugin<string> = {
      id: addedId,
      init: () => "ready",
      apply: ({ state }) => state,
    };
    const editor = new TerminalEditor({ plugins: [retained] });
    editor.handleInput({ kind: "text", text: "x" });

    editor.setPlugins([replacement, added]);
    expect(editor.getPluginState(retainedId)).toBe(1);
    expect(editor.getPluginState(addedId)).toBe("ready");
    expect(replacementInit).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();

    editor.setPlugins([added]);
    expect(editor.getPluginState(retainedId)).toBeUndefined();
    expect(removed).toHaveBeenCalledOnce();
    editor.destroy();
    editor.destroy();
    expect(removed).toHaveBeenCalledOnce();
  });

  it("notifies the host when plugins are reconfigured", () => {
    const onChange = vi.fn();
    const editor = new TerminalEditor({ onChange });
    editor.setPlugins([]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("invalidates presentation without changing source revision", () => {
    const render = vi.fn(() => []);
    const plugin: EditorPlugin<null> = {
      id: new PluginId("external-presentation"),
      init: () => null,
      apply: ({ state }) => state,
      decorations: render,
    };
    const editor = new TerminalEditor({ content: "text", plugins: [plugin] });
    const listener = vi.fn();
    editor.onUpdate(listener);
    const revision = editor.snapshot().revision;
    editor.output();
    editor.invalidatePresentation();
    editor.output();
    expect(editor.snapshot().revision).toBe(revision);
    expect(render).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("rejects duplicate plugin ids before changing configuration", () => {
    const id = new PluginId<null>("duplicate");
    const plugin: EditorPlugin<null> = {
      id,
      init: () => null,
      apply: ({ state }) => state,
    };
    const editor = new TerminalEditor({ plugins: [plugin] });
    expect(() => editor.setPlugins([plugin, { ...plugin }]))
      .toThrow('Duplicate plugin id "duplicate".');
    expect(editor.getPluginState(id)).toBeNull();
  });

  it("places and extends the selection with primary-button mouse input", () => {
    const editor = new TerminalEditor({ content: "abcdef" });
    const viewport = { width: 20, height: 2 };

    expect(editor.handleInput(
      { kind: "mouse", action: "press", button: "left", column: 1, row: 0 },
      viewport,
    )).toBe(true);
    expect(editor.handleInput(
      { kind: "mouse", action: "move", button: "left", column: 4, row: 0 },
      viewport,
    )).toBe(true);
    editor.handleInput(
      { kind: "mouse", action: "release", button: "left", column: 4, row: 0 },
      viewport,
    );

    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 4 },
    });
  });

  it("skips hidden block-widget source during vertical movement", () => {
    const plugin: EditorPlugin<null> = {
      id: new PluginId("vertical-widget"),
      init: () => null,
      apply: () => null,
      widgets: () => [{
        key: "vertical-widget:block",
        placement: "block",
        range: {
          from: { paragraph: 1, offset: 0 },
          to: { paragraph: 1, offset: 6 },
        },
        props: {},
        render: { render: () => ({ lines: ["widget", "widget"] }) },
        selection: "block",
      }],
    };
    const editor = new TerminalEditor({
      content: "before\nwidget\nafter",
      plugins: [plugin],
    });
    editor.dispatch(editor.createTransaction().setSelection({
      anchor: { paragraph: 0, offset: 6 },
      head: { paragraph: 0, offset: 6 },
    }).build());

    expect(editor.frame(20, 6).rows.slice(0, 4).map((row) =>
      row.cells.map((cell) => cell.text).join("")
    )).toEqual(["before", "widget", "widget", "after"]);
    expect(editor.handleInput({ kind: "key", key: "ArrowDown" })).toBe(true);
    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 2, offset: 0 },
      head: { paragraph: 2, offset: 0 },
    });
    expect(editor.handleInput({ kind: "key", key: "ArrowUp" })).toBe(true);
    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 6 },
      head: { paragraph: 0, offset: 6 },
    });

    expect(editor.handleInput({
      kind: "key",
      key: "ArrowDown",
      shift: true,
    })).toBe(true);
    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 6 },
      head: { paragraph: 2, offset: 0 },
    });
  });

  it("focuses only block widgets that opt into vertical focus", () => {
    const plugin: EditorPlugin<null> = {
      id: new PluginId("focusable-vertical-widget"),
      init: () => null,
      apply: () => null,
      widgets: () => [{
        key: "focusable-vertical-widget:block",
        placement: "block",
        range: {
          from: { paragraph: 1, offset: 0 },
          to: { paragraph: 1, offset: 6 },
        },
        props: {},
        render: {
          render: () => ({ lines: ["widget"] }),
          handleInput: () => false,
        },
        selection: "block",
        focusable: true,
      }],
    };
    const editor = new TerminalEditor({
      content: "before\nwidget\nafter",
      plugins: [plugin],
    });
    editor.dispatch(editor.createTransaction().setSelection({
      anchor: { paragraph: 0, offset: 6 },
      head: { paragraph: 0, offset: 6 },
    }).build());

    expect(editor.handleInput({ kind: "key", key: "ArrowDown" })).toBe(true);
    expect(editor.frame(20, 6).cursor.visible).toBe(false);
    expect(editor.handleInput({ kind: "key", key: "ArrowDown" })).toBe(true);
    expect(editor.snapshot().selection.head).toEqual({ paragraph: 2, offset: 0 });
    expect(editor.frame(20, 6).cursor.visible).toBe(true);

    editor.focusEditor({ paragraph: 2, offset: 0 });
    expect(editor.handleInput({ kind: "key", key: "ArrowUp" })).toBe(true);
    expect(editor.frame(20, 6).cursor.visible).toBe(false);
  });

  it("extends the existing selection with shift-click", () => {
    const editor = new TerminalEditor({ content: "abcdef" });
    const viewport = { width: 20, height: 2 };
    editor.handleInput(
      { kind: "mouse", action: "press", button: "left", column: 1, row: 0 },
      viewport,
    );
    editor.handleInput(
      {
        kind: "mouse",
        action: "press",
        button: "left",
        column: 5,
        row: 0,
        shift: true,
      },
      viewport,
    );

    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 5 },
    });
  });

  it("maps mouse rows through the caret-following viewport", () => {
    const editor = new TerminalEditor({ content: "a\nb\nc\nd" });
    editor.dispatch(
      editor.createTransaction().setSelection({
        anchor: { paragraph: 3, offset: 1 },
        head: { paragraph: 3, offset: 1 },
      }).build(),
    );

    editor.handleInput(
      { kind: "mouse", action: "press", button: "left", column: 0, row: 0 },
      { width: 20, height: 2 },
    );

    expect(editor.snapshot().selection.head).toEqual({ paragraph: 2, offset: 0 });
  });

  it("uses the last rendered viewport when handling mouse input", () => {
    const editor = new TerminalEditor({ content: "a\nb\nc\nd" });
    editor.dispatch(
      editor.createTransaction().setSelection({
        anchor: { paragraph: 3, offset: 1 },
        head: { paragraph: 3, offset: 1 },
      }).build(),
    );
    editor.frame(20, 2);

    editor.handleInput(
      { kind: "mouse", action: "press", button: "left", column: 0, row: 0 },
    );

    expect(editor.snapshot().selection.head).toEqual({ paragraph: 2, offset: 0 });
  });

  it("ends a primary-button drag on any release event", () => {
    const editor = new TerminalEditor({ content: "abcdef" });
    const viewport = { width: 20, height: 2 };
    editor.handleInput(
      { kind: "mouse", action: "press", button: "left", column: 1, row: 0 },
      viewport,
    );
    expect(editor.handleInput(
      { kind: "mouse", action: "release", button: "right", column: 2, row: 0 },
      viewport,
    )).toBe(true);
    expect(editor.handleInput(
      { kind: "mouse", action: "move", button: "left", column: 5, row: 0 },
      viewport,
    )).toBe(false);
    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 1 },
      head: { paragraph: 0, offset: 1 },
    });
  });

  it("scrolls independently with wheel input", () => {
    const editor = new TerminalEditor({
      content: Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n"),
    });
    const viewport = { width: 20, height: 3 };
    editor.frame(viewport.width, viewport.height);
    expect(editor.handleInput(
      { kind: "mouse", action: "wheel", button: "wheelDown", column: 0, row: 0 },
      viewport,
    )).toBe(true);
    expect(editor.scrollState(viewport).topRow).toBe(3);
    const frame = editor.frame(viewport.width, viewport.height);
    expect(frame.rows[0].cells.map((cell) => cell.text).join("")).toBe("line 3");
    expect(frame.cursor.visible).toBe(false);
  });

  it("reveals the caret after editing navigation", () => {
    const editor = new TerminalEditor({
      content: Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n"),
    });
    const viewport = { width: 20, height: 3 };
    editor.frame(viewport.width, viewport.height);
    editor.execute("editor.moveDocumentEnd");
    expect(editor.frame(viewport.width, viewport.height).cursor.visible).toBe(true);
    expect(editor.scrollState(viewport).topRow).toBe(7);

    editor.execute("editor.moveDocumentStart");
    const frame = editor.frame(viewport.width, viewport.height);
    expect(editor.scrollState(viewport).topRow).toBe(0);
    expect(frame.cursor.visible).toBe(true);
  });

  it("does not cancel pending caret reveal when querying scroll state", () => {
    const editor = new TerminalEditor({ content: "a\nb\nc\nd\ne" });
    const viewport = { width: 20, height: 2 };
    editor.frame(viewport.width, viewport.height);
    editor.execute("editor.moveDocumentEnd");
    editor.scrollState(viewport);
    editor.frame(viewport.width, viewport.height);
    expect(editor.scrollState(viewport).topRow).toBe(3);
  });

  it("autoscrolls while extending a mouse selection at the viewport edge", () => {
    const editor = new TerminalEditor({ content: "a\nb\nc\nd\ne" });
    const viewport = { width: 20, height: 2 };
    editor.frame(viewport.width, viewport.height);
    editor.scrollToRow(2, viewport);
    editor.handleInput(
      { kind: "mouse", action: "press", button: "left", column: 0, row: 1 },
      viewport,
    );
    editor.handleInput(
      { kind: "mouse", action: "move", button: "left", column: 0, row: 0 },
      viewport,
    );

    expect(editor.scrollState(viewport).topRow).toBe(1);
    expect(editor.snapshot().selection).toEqual({
      anchor: { paragraph: 3, offset: 0 },
      head: { paragraph: 1, offset: 0 },
    });
  });

  it("focuses interactive widgets and routes actions through transactions", () => {
    const focused: boolean[] = [];
    const plugin: EditorPlugin<null> = {
      id: new PluginId("widget"),
      init: () => null,
      apply: ({ state }) => state,
      widgets: ({ content }) => content.startsWith("[x]")
        ? [{
            key: "widget:checkbox",
            placement: "inline",
            range: {
              from: { paragraph: 0, offset: 0 },
              to: { paragraph: 0, offset: 3 },
            },
            props: {},
            selection: "atom",
            render: {
              render: ({ focused: isFocused }) => {
                focused.push(isFocused);
                return { lines: ["☑"] };
              },
              handleInput: ({ event, replaceSelf }) =>
                event.kind === "text"
                  ? replaceSelf(event.text)
                  : event.kind === "key" && event.key === "Enter"
                    ? replaceSelf("[ ]")
                    : false,
            },
          }]
        : [],
    };
    const editor = new TerminalEditor({ content: "[x] task", plugins: [plugin] });

    expect(editor.handleInput({ kind: "key", key: "Tab" })).toBe(true);
    expect(editor.frame(20, 2).cursor.visible).toBe(false);
    expect(focused.at(-1)).toBe(true);
    expect(editor.handleInput({ kind: "text", text: "z" })).toBe(true);
    expect(editor.snapshot().content).toBe("z task");
    expect(editor.execute("editor.undo")).toBe(true);
    expect(editor.focusWidget("widget:checkbox")).toBe(true);
    expect(editor.handleInput({ kind: "key", key: "Enter" })).toBe(true);
    expect(editor.snapshot().content).toBe("[ ] task");
    expect(editor.execute("editor.undo")).toBe(true);
    expect(editor.focusWidget("widget:checkbox")).toBe(true);
    expect(editor.handleInput({ kind: "key", key: "Tab" })).toBe(true);
    expect(editor.frame(20, 2).cursor.visible).toBe(true);
    expect(editor.snapshot().content).toBe("[x] task");
  });

  it("activates widgets by mouse and hands focus back to the editor", () => {
    const plugin: EditorPlugin<null> = {
      id: new PluginId("mouse-widget"),
      init: () => null,
      apply: ({ state }) => state,
      widgets: ({ selection }) => selection.head.offset >= 3 ? [{
        key: "widget:delete",
        placement: "inline",
        range: {
          from: { paragraph: 0, offset: 0 },
          to: { paragraph: 0, offset: 3 },
        },
        props: {},
        selection: "atom",
        render: {
          render: () => ({ lines: ["×"] }),
          handleInput: ({ event, deleteSelf }) =>
            event.kind === "mouse" && event.action === "press"
              ? deleteSelf()
              : false,
        },
      }] : [],
    };
    const editor = new TerminalEditor({ content: "[x] task", plugins: [plugin] });
    const viewport = { width: 20, height: 2 };
    editor.dispatch(
      editor.createTransaction().setSelection({
        anchor: { paragraph: 0, offset: 8 },
        head: { paragraph: 0, offset: 8 },
      }).build(),
    );
    editor.frame(viewport.width, viewport.height);

    expect(editor.handleInput(
      { kind: "mouse", action: "press", button: "left", column: 0, row: 0 },
      viewport,
    )).toBe(true);
    expect(editor.snapshot().content).toBe(" task");
    expect(editor.execute("editor.undo")).toBe(true);
    editor.dispatch(
      editor.createTransaction().setSelection({
        anchor: { paragraph: 0, offset: 8 },
        head: { paragraph: 0, offset: 8 },
      }).build(),
    );
    expect(editor.focusWidget("widget:delete")).toBe(true);
    editor.focusEditor({ paragraph: 0, offset: 3 });
    expect(editor.frame(viewport.width, viewport.height).cursor.visible).toBe(true);
    expect(editor.snapshot().selection.head).toEqual({ paragraph: 0, offset: 3 });
  });
});

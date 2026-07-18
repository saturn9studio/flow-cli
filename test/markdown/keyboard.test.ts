import { describe, expect, it } from "vitest";
import { boot, type KeyInputEvent } from "../../src/markdown/index.js";

const key = (keyName: string, shift = false): KeyInputEvent => ({
  kind: "key",
  key: keyName,
  ctrl: false,
  alt: false,
  shift,
  meta: false,
});

const placeCaret = (
  flowEditor: ReturnType<typeof boot>,
  paragraph: number,
  offset: number,
): void => {
  const position = { paragraph, offset };
  flowEditor.editor.dispatch(
    flowEditor.editor
      .createTransaction()
      .setSelection({ anchor: position, head: position })
      .build(),
  );
};

describe("Flow CLI Markdown keyboard behavior", () => {
  it("continues and exits ordered lists", () => {
    const flowEditor = boot({ content: "1. one" });
    placeCaret(flowEditor, 0, 6);
    expect(flowEditor.editor.handleInput(key("Enter"))).toBe(true);
    expect(flowEditor.getContent()).toBe("1. one\n2. ");
    expect(flowEditor.editor.handleInput(key("Enter"))).toBe(true);
    expect(flowEditor.getContent()).toBe("1. one\n");
  });

  it("continues and exits blockquotes", () => {
    const flowEditor = boot({ content: "> quote" });
    placeCaret(flowEditor, 0, 7);
    flowEditor.editor.handleInput(key("Enter"));
    expect(flowEditor.getContent()).toBe("> quote\n> ");
    flowEditor.editor.handleInput(key("Backspace"));
    expect(flowEditor.getContent()).toBe("> quote\n");
  });

  it("indents and outdents selected list items", () => {
    const flowEditor = boot({ content: "- one\n- two" });
    flowEditor.editor.dispatch(
      flowEditor.editor
        .createTransaction()
        .setSelection({
          anchor: { paragraph: 0, offset: 0 },
          head: { paragraph: 1, offset: 5 },
        })
        .build(),
    );
    flowEditor.editor.handleInput(key("Tab"));
    expect(flowEditor.getContent()).toBe("\t- one\n\t- two");
    flowEditor.editor.handleInput(key("Tab", true));
    expect(flowEditor.getContent()).toBe("- one\n- two");
  });

  it("falls back to core editing outside Markdown structures", () => {
    const flowEditor = boot({ content: "plain" });
    placeCaret(flowEditor, 0, 5);
    flowEditor.editor.handleInput(key("Enter"));
    expect(flowEditor.getContent()).toBe("plain\n");
    expect(flowEditor.editor.frame(20, 2).cursor).toEqual({
      row: 1,
      column: 0,
      visible: true,
    });
    flowEditor.editor.handleInput(key("Backspace"));
    expect(flowEditor.getContent()).toBe("plain");
  });

  it("requires a blank source line to start a Markdown paragraph", () => {
    const flowEditor = boot({ content: "first" });
    placeCaret(flowEditor, 0, 5);

    flowEditor.editor.handleInput(key("Enter"));
    flowEditor.editor.handleInput({ kind: "text", text: "second" });
    expect(flowEditor.getContent()).toBe("first\nsecond");

    flowEditor.editor.handleInput(key("Enter"));
    flowEditor.editor.handleInput(key("Enter"));
    flowEditor.editor.handleInput({ kind: "text", text: "third" });
    expect(flowEditor.getContent()).toBe("first\nsecond\n\nthird");
  });
});

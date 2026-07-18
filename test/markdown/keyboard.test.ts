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
  scribe: ReturnType<typeof boot>,
  paragraph: number,
  offset: number,
): void => {
  const position = { paragraph, offset };
  scribe.editor.dispatch(
    scribe.editor
      .createTransaction()
      .setSelection({ anchor: position, head: position })
      .build(),
  );
};

describe("Flow CLI Markdown keyboard behavior", () => {
  it("continues and exits ordered lists", () => {
    const scribe = boot({ content: "1. one" });
    placeCaret(scribe, 0, 6);
    expect(scribe.editor.handleInput(key("Enter"))).toBe(true);
    expect(scribe.getContent()).toBe("1. one\n2. ");
    expect(scribe.editor.handleInput(key("Enter"))).toBe(true);
    expect(scribe.getContent()).toBe("1. one\n");
  });

  it("continues and exits blockquotes", () => {
    const scribe = boot({ content: "> quote" });
    placeCaret(scribe, 0, 7);
    scribe.editor.handleInput(key("Enter"));
    expect(scribe.getContent()).toBe("> quote\n> ");
    scribe.editor.handleInput(key("Backspace"));
    expect(scribe.getContent()).toBe("> quote\n");
  });

  it("indents and outdents selected list items", () => {
    const scribe = boot({ content: "- one\n- two" });
    scribe.editor.dispatch(
      scribe.editor
        .createTransaction()
        .setSelection({
          anchor: { paragraph: 0, offset: 0 },
          head: { paragraph: 1, offset: 5 },
        })
        .build(),
    );
    scribe.editor.handleInput(key("Tab"));
    expect(scribe.getContent()).toBe("\t- one\n\t- two");
    scribe.editor.handleInput(key("Tab", true));
    expect(scribe.getContent()).toBe("- one\n- two");
  });

  it("falls back to core editing outside Markdown structures", () => {
    const scribe = boot({ content: "plain" });
    placeCaret(scribe, 0, 5);
    scribe.editor.handleInput(key("Enter"));
    expect(scribe.getContent()).toBe("plain\n");
    expect(scribe.editor.frame(20, 2).cursor).toEqual({
      row: 1,
      column: 0,
      visible: true,
    });
    scribe.editor.handleInput(key("Backspace"));
    expect(scribe.getContent()).toBe("plain");
  });

  it("requires a blank source line to start a Markdown paragraph", () => {
    const scribe = boot({ content: "first" });
    placeCaret(scribe, 0, 5);

    scribe.editor.handleInput(key("Enter"));
    scribe.editor.handleInput({ kind: "text", text: "second" });
    expect(scribe.getContent()).toBe("first\nsecond");

    scribe.editor.handleInput(key("Enter"));
    scribe.editor.handleInput(key("Enter"));
    scribe.editor.handleInput({ kind: "text", text: "third" });
    expect(scribe.getContent()).toBe("first\nsecond\n\nthird");
  });
});

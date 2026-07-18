import { describe, expect, it, vi } from "vitest";
import { PluginId, type EditorPlugin } from "../../src/engine/index.js";
import { boot, isMarkdownSyntaxSnapshot } from "../../src/markdown/index.js";

interface TestState {
  readonly changes: number;
}

const testPluginId = new PluginId<TestState>("test");

const testPlugin = (onApply: () => void): EditorPlugin<TestState> => ({
  id: testPluginId,
  init: () => ({ changes: 0 }),
  apply: ({ state, transaction }) => {
    if (transaction.displayChanges.length === 0) return state;
    onApply();
    return { changes: state.changes + 1 };
  },
});

describe("Flow CLI boot", () => {
  it("preserves content and composes custom plugin factories", () => {
    const onApply = vi.fn();
    const content = "# Draft\n\nText";
    const scribe = boot({
      content,
      plugins: [() => testPlugin(onApply)],
    });

    expect(scribe.getContent()).toBe(content);
    expect(isMarkdownSyntaxSnapshot(scribe.editor.snapshot().syntax)).toBe(true);

    scribe.editor.handleInput({ kind: "text", text: "A" });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(scribe.getContent()).toBe("A# Draft\n\nText");
  });

  it("supports a plain-text configuration without Markdown", () => {
    const scribe = boot({ content: "plain", markdown: false });
    expect(scribe.editor.snapshot().syntax.kind).toBe("none");
    expect(scribe.editor.output().decorations).toEqual([]);
  });

  it("honors read-only editing", () => {
    const scribe = boot({ content: "unchanged", readOnly: true });
    expect(scribe.editor.handleInput({ kind: "text", text: "x" })).toBe(true);
    expect(scribe.getContent()).toBe("unchanged");
  });

  it("preserves Markdown through replacement, deletion, undo, and redo", () => {
    const scribe = boot({ content: "# Draft\n\n**bold** text" });
    scribe.editor.dispatch(
      scribe.editor.createTransaction().setSelection({
        anchor: { paragraph: 2, offset: 2 },
        head: { paragraph: 2, offset: 6 },
      }).build(),
    );
    scribe.editor.handleInput({ kind: "text", text: "strong" });
    expect(scribe.getContent()).toBe("# Draft\n\n**strong** text");

    scribe.editor.handleInput({
      kind: "key",
      key: "Backspace",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(scribe.getContent()).toBe("# Draft\n\n**stron** text");
    expect(scribe.editor.execute("editor.undo")).toBe(true);
    expect(scribe.getContent()).toBe("# Draft\n\n**strong** text");
    expect(scribe.editor.execute("editor.redo")).toBe(true);
    expect(scribe.getContent()).toBe("# Draft\n\n**stron** text");
  });
});

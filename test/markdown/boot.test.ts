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
    const flowEditor = boot({
      content,
      plugins: [() => testPlugin(onApply)],
    });

    expect(flowEditor.getContent()).toBe(content);
    expect(isMarkdownSyntaxSnapshot(flowEditor.editor.snapshot().syntax)).toBe(true);

    flowEditor.editor.handleInput({ kind: "text", text: "A" });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(flowEditor.getContent()).toBe("A# Draft\n\nText");
  });

  it("supports a plain-text configuration without Markdown", () => {
    const flowEditor = boot({ content: "plain", markdown: false });
    expect(flowEditor.editor.snapshot().syntax.kind).toBe("none");
    expect(flowEditor.editor.output().decorations).toEqual([]);
  });

  it("honors read-only editing", () => {
    const flowEditor = boot({ content: "unchanged", readOnly: true });
    expect(flowEditor.editor.handleInput({ kind: "text", text: "x" })).toBe(true);
    expect(flowEditor.getContent()).toBe("unchanged");
  });

  it("preserves Markdown through replacement, deletion, undo, and redo", () => {
    const flowEditor = boot({ content: "# Draft\n\n**bold** text" });
    flowEditor.editor.dispatch(
      flowEditor.editor.createTransaction().setSelection({
        anchor: { paragraph: 2, offset: 2 },
        head: { paragraph: 2, offset: 6 },
      }).build(),
    );
    flowEditor.editor.handleInput({ kind: "text", text: "strong" });
    expect(flowEditor.getContent()).toBe("# Draft\n\n**strong** text");

    flowEditor.editor.handleInput({
      kind: "key",
      key: "Backspace",
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
    expect(flowEditor.getContent()).toBe("# Draft\n\n**stron** text");
    expect(flowEditor.editor.execute("editor.undo")).toBe(true);
    expect(flowEditor.getContent()).toBe("# Draft\n\n**strong** text");
    expect(flowEditor.editor.execute("editor.redo")).toBe(true);
    expect(flowEditor.getContent()).toBe("# Draft\n\n**stron** text");
  });
});

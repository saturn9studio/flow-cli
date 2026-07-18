import { describe, expect, it, vi } from "vitest";
import {
  boot,
  dispatchLintResults,
  lintDecorationsPluginId,
  withTextHighlights,
  type WordCount,
} from "../../src/markdown/index.js";

describe("Flow CLI authoring plugins", () => {
  it("renders placeholder text only for an empty document", () => {
    const flowEditor = boot({ placeholder: "Start writing..." });
    const widget = flowEditor.editor.output().widgets[0];
    expect(widget?.key).toBe("scribecli.placeholder:empty");
    expect(widget?.render.render({
      props: widget.props,
      sourceText: "",
      width: 80,
      readOnly: false,
      focused: false,
    }).lines).toEqual([[
      { text: "Start writing...", style: { role: "placeholder", dim: true } },
    ]]);
    flowEditor.editor.handleInput({ kind: "text", text: "A" });
    expect(flowEditor.editor.output().widgets).toEqual([]);
  });

  it("separates source-change and selection-count callbacks", () => {
    const changed = vi.fn();
    const counts: WordCount[] = [];
    const flowEditor = boot({
      content: "one two",
      onDocumentChanged: changed,
      onWordCount: (count) => counts.push(count),
    });
    expect(counts.at(-1)).toMatchObject({
      words: 2,
      characters: 7,
      isSelection: false,
    });

    flowEditor.editor.dispatch(
      flowEditor.editor
        .createTransaction()
        .setSelection({
          anchor: { paragraph: 0, offset: 0 },
          head: { paragraph: 0, offset: 3 },
        })
        .build(),
    );
    expect(changed).not.toHaveBeenCalled();
    expect(counts.at(-1)).toMatchObject({
      words: 1,
      characters: 3,
      isSelection: true,
    });

    flowEditor.editor.handleInput({ kind: "text", text: "three" });
    expect(changed).toHaveBeenCalledWith("three two");
  });

  it("decorates the current sentence only for collapsed selections", () => {
    const flowEditor = boot({
      content: "One. Two here. Three.",
      currentSentence: true,
    });
    const caret = { paragraph: 0, offset: 6 };
    flowEditor.editor.dispatch(
      flowEditor.editor
        .createTransaction()
        .setSelection({ anchor: caret, head: caret })
        .build(),
    );
    expect(flowEditor.editor.output().decorations).toContainEqual({
      kind: "inline",
      from: 4,
      to: 14,
      style: { role: "currentSentence" },
    });
  });

  it("recomputes generic highlights only when source changes", () => {
    const matcher = vi.fn((content: string) => {
      const from = content.indexOf("verb");
      return from < 0 ? [] : [{ from, to: from + 4, role: "verb" }];
    });
    const flowEditor = boot({
      content: "a verb",
      plugins: [() => withTextHighlights(matcher)],
    });
    expect(matcher).toHaveBeenCalledOnce();
    const caret = { paragraph: 0, offset: 0 };
    flowEditor.editor.dispatch(
      flowEditor.editor
        .createTransaction()
        .setSelection({ anchor: caret, head: caret })
        .build(),
    );
    expect(matcher).toHaveBeenCalledOnce();
    flowEditor.editor.handleInput({ kind: "text", text: "x" });
    expect(matcher).toHaveBeenCalledTimes(2);
  });

  it("clears stale lint ranges immediately after source edits", () => {
    const flowEditor = boot({ content: "bad" });
    const snapshot = flowEditor.editor.snapshot();
    dispatchLintResults(flowEditor.editor, [{
      from: 0,
      to: 3,
      message: "Bad",
      category: "spelling",
    }]);
    expect(flowEditor.editor.getPluginState(lintDecorationsPluginId)).toHaveLength(1);
    flowEditor.editor.dispatch(
      flowEditor.editor
        .createTransaction()
        .setSelection({
          anchor: snapshot.selection.anchor,
          head: snapshot.selection.head,
        })
        .replaceSelection("x")
        .build(),
    );
    expect(flowEditor.editor.getPluginState(lintDecorationsPluginId)).toEqual([]);
  });
});

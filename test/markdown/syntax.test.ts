import { describe, expect, it } from "vitest";
import {
  TerminalEditor,
  documentFromText,
} from "../../src/engine/index.js";
import {
  buildMarkdownSyntaxSnapshot,
  markdownSyntaxProvider,
  requireMarkdownSyntaxSnapshot,
} from "../../src/markdown/index.js";

describe("Markdown syntax provider", () => {
  it("uses the supported parser preset and leaves unclosed fences as source text", () => {
    const closed = buildMarkdownSyntaxSnapshot(
      documentFromText("# Heading\n\n```ts\nconst value = 1;\n```"),
    );
    const unclosed = buildMarkdownSyntaxSnapshot(
      documentFromText("```ts\nconst value = 1;"),
    );

    expect(closed.tokenViews.map((view) => view.kind)).toContain("heading");
    expect(closed.tokenViews.map((view) => view.kind)).toContain("fence");
    expect(unclosed.tokenViews.map((view) => view.kind)).not.toContain("fence");
  });

  it("recognizes closed math blocks and leaves unclosed math blocks as source text", () => {
    const closed = buildMarkdownSyntaxSnapshot(
      documentFromText("before\n\n$$\nE = mc^2\n$$\n\nafter"),
    );
    const unclosed = buildMarkdownSyntaxSnapshot(
      documentFromText("$$\nE = mc^2"),
    );

    expect(closed.tokenViews.map((view) => view.kind)).toContain("math_block");
    expect(unclosed.tokenViews.map((view) => view.kind)).not.toContain(
      "math_block",
    );
  });

  it("retains the syntax snapshot for selection-only transactions", () => {
    const editor = new TerminalEditor({
      content: "**bold**",
      syntaxProvider: markdownSyntaxProvider,
    });
    const before = editor.snapshot().syntax;

    editor.dispatch(
      editor.createTransaction().setSelection({
        anchor: { paragraph: 0, offset: 3 },
        head: { paragraph: 0, offset: 3 },
      }).build(),
    );

    expect(editor.snapshot().syntax).toBe(before);
  });

  it("increments syntax versions and matches edited source", () => {
    const editor = new TerminalEditor({
      content: "# Heading",
      syntaxProvider: markdownSyntaxProvider,
    });
    const before = requireMarkdownSyntaxSnapshot(editor.snapshot().syntax);

    editor.dispatch(
      editor.createTransaction().replaceRange(
        { paragraph: 0, offset: 2 },
        { paragraph: 0, offset: 9 },
        "Changed",
      ).build(),
    );
    const after = requireMarkdownSyntaxSnapshot(editor.snapshot().syntax);

    expect(after.version).toBe(before.version + 1);
    expect(after.source).toBe("# Changed");
    expect(after.parseState.src).toBe(after.source);
  });

  it("keeps UTF-16 offsets aligned around emoji", () => {
    const source = "😀 **bold**";
    const snapshot = buildMarkdownSyntaxSnapshot(documentFromText(source));
    expect(snapshot.source.indexOf("**")).toBe(3);
  });
});

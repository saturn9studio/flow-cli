import { describe, expect, it, vi } from "vitest";
import {
  boot,
  createMarkdownBlockWidgets,
  defaultMathBlockRenderer,
  defaultTableRenderer,
  documentFromText,
  flowCliMarkdownParser,
  type KeyInputEvent,
} from "../../src/markdown/index.js";

const key = (
  keyName: string,
  modifiers: Partial<Pick<KeyInputEvent, "ctrl" | "meta">> = {},
): KeyInputEvent => ({
  kind: "key",
  key: keyName,
  ctrl: modifiers.ctrl ?? false,
  alt: false,
  shift: false,
  meta: modifiers.meta ?? false,
});

describe("Flow CLI block surfaces", () => {
  it("renders themed tables with box-drawing borders", () => {
    const rendered = defaultTableRenderer.render({
      props: { rows: [["Name", "Value"], ["One", "1"], ["Two", "2"]] },
      sourceText: "",
      width: 21,
      readOnly: true,
      focused: false,
    });
    const text = rendered.lines.map((line) =>
      typeof line === "string" ? line : line.map((run) => run.text).join("")
    );

    expect(text).toEqual([
      "┌─────────┬─────────┐",
      "│Name     │Value    │",
      "├─────────┼─────────┤",
      "│One      │1        │",
      "│Two      │2        │",
      "└─────────┴─────────┘",
    ]);
    expect(rendered.lines[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ style: { role: "tableHeader" } }),
    ]));
    expect(rendered.lines[3]).toEqual(expect.arrayContaining([
      expect.objectContaining({ style: { role: "tableCell" } }),
    ]));
  });

  it("creates code, table, and task widgets without changing source", () => {
    const content = [
      "```ts",
      "const value = 1;",
      "```",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| One | 1 |",
      "",
      "- [ ] todo",
    ].join("\n");
    const doc = documentFromText(content);
    const widgets = createMarkdownBlockWidgets(
      doc,
      {
        anchor: { paragraph: 3, offset: 0 },
        head: { paragraph: 3, offset: 0 },
      },
      content,
    );
    expect(widgets.map((widget) => widget.key.split(":")[0])).toEqual([
      "scribecli.code",
      "scribecli.table",
      "scribecli.task",
    ]);
    expect(content).toContain("const value = 1;");
  });

  it("uses readable narrow-width fallbacks", () => {
    const content = "```typescript\nconst exceptionallyLongName = true;\n```";
    const doc = documentFromText(content);
    const widget = createMarkdownBlockWidgets(
      doc,
      {
        anchor: { paragraph: 0, offset: 0 },
        head: { paragraph: 0, offset: 0 },
      },
      content,
    )[0]!;
    const result = widget.render.render({
      props: widget.props,
      sourceText: content,
      width: 8,
      readOnly: false,
      focused: false,
    });
    expect(
      result.lines.every((line) =>
        typeof line === "string"
          ? [...line].length <= 8
          : line.reduce((length, run) => length + [...run.text].length, 0) <= 8,
      ),
    ).toBe(true);
  });

  it("highlights code and shows its language only while focused", () => {
    const block = "```typescript\nconst value = \"text\";\n```";
    const content = `${block}\n\nafter`;
    const doc = documentFromText(content);
    const widget = createMarkdownBlockWidgets(
      doc,
      {
        anchor: { paragraph: 4, offset: 0 },
        head: { paragraph: 4, offset: 0 },
      },
      content,
    )[0]!;
    const render = (focused: boolean) => widget.render.render({
      props: widget.props,
      sourceText: block,
      width: 80,
      readOnly: false,
      focused,
    });

    expect(render(false).lines).toHaveLength(1);
    expect(render(false).lines.flatMap((line) => line).map((run) => run.text))
      .not.toContain("code");
    expect(render(true).lines[0]).toEqual([
      {
        text: "code · typescript",
        style: { role: "codeBlockLabel", dim: true },
      },
    ]);
    expect(render(false).lines[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ style: { role: "codeSyntax.keyword" } }),
      expect.objectContaining({ style: { role: "codeSyntax.string" } }),
    ]));
    expect(widget.focusable).toBe(true);
  });

  it("highlights math blocks as LaTeX and shows the math label only while focused", () => {
    const block = "$$\n\\frac{a}{b} = c\n$$";
    const content = `${block}\n\nafter`;
    const doc = documentFromText(content);
    const widget = createMarkdownBlockWidgets(
      doc,
      {
        anchor: { paragraph: 4, offset: 0 },
        head: { paragraph: 4, offset: 0 },
      },
      content,
    )[0]!;
    const render = (focused: boolean) => widget.render.render({
      props: widget.props,
      sourceText: block,
      width: 80,
      readOnly: false,
      focused,
    });

    expect(widget.key).toBe("scribecli.math:0");
    expect(render(false).lines).toHaveLength(1);
    expect(render(true).lines[0]).toEqual([
      {
        text: "math · latex",
        style: { role: "codeBlockLabel", dim: true },
      },
    ]);
    expect(render(false).lines[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ style: { role: "codeSyntax.keyword" } }),
    ]));
    expect(widget.focusable).toBe(true);
    expect(defaultMathBlockRenderer).toBeDefined();
  });

  it("does not create nested code and math widgets inside each other", () => {
    const mathInCode = "```md\n$$\nE = mc^2\n$$\n```";
    const codeInMath = "$$\n```ts\nconst value = 1;\n```\n$$";
    const selection = {
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 0 },
    };

    expect(createMarkdownBlockWidgets(
      documentFromText(mathInCode),
      selection,
      mathInCode,
    ).map((widget) => widget.key.split(":")[0])).toEqual([
      "scribecli.code",
    ]);
    expect(createMarkdownBlockWidgets(
      documentFromText(codeInMath),
      selection,
      codeInMath,
    ).map((widget) => widget.key.split(":")[0])).toEqual([
      "scribecli.math",
    ]);
  });

  it("mutes code widgets in Focus mode until they receive focus", () => {
    const content = "```ts\nconst value = 1;\n```";
    const widget = createMarkdownBlockWidgets(
      documentFromText(content),
      {
        anchor: { paragraph: 0, offset: 0 },
        head: { paragraph: 0, offset: 0 },
      },
      content,
      { mode: "focus" },
    )[0]!;
    const render = (focused: boolean) => widget.render.render({
      props: widget.props,
      sourceText: content,
      width: 80,
      readOnly: false,
      focused,
    });

    expect(render(false).lines.flatMap((line) => line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          style: { role: "focusInactive", dim: true },
        }),
      ]),
    );
    expect(render(true).lines.flatMap((line) => line)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ style: { role: "codeSyntax.keyword" } }),
      ]),
    );
  });

  it("moves vertical navigation into code widgets from either direction", () => {
    const content = "before\n```ts\nconst value = 1;\n```\nafter";
    const scribe = boot({ content });
    const placeCaret = (paragraph: number, offset: number) => {
      const position = { paragraph, offset };
      scribe.editor.dispatch(
        scribe.editor.createTransaction().setSelection({
          anchor: position,
          head: position,
        }).build(),
      );
    };
    const frameText = () => scribe.editor.frame(80, 10).rows
      .flatMap((row) => row.cells)
      .map((cell) => cell.text)
      .join("");

    placeCaret(0, "before".length);
    expect(scribe.editor.handleInput(key("ArrowDown"))).toBe(true);
    expect(scribe.editor.frame(80, 10).cursor.visible).toBe(false);
    expect(frameText()).toContain("code · ts");

    scribe.editor.focusEditor({ paragraph: 4, offset: 0 });
    expect(scribe.editor.handleInput(key("ArrowUp"))).toBe(true);
    expect(scribe.editor.frame(80, 10).cursor.visible).toBe(false);
    expect(frameText()).toContain("code · ts");
  });

  it("toggles task widgets transactionally", () => {
    const scribe = boot({ content: "- [ ] task" });
    expect(scribe.editor.focusWidget("scribecli.task:2")).toBe(true);
    expect(scribe.editor.handleInput(key(" "))).toBe(true);
    expect(scribe.getContent()).toBe("- [x] task");
    expect(scribe.editor.execute("editor.undo")).toBe(true);
    expect(scribe.getContent()).toBe("- [ ] task");
  });

  it("hands code widgets back to exact raw source", () => {
    const content = "```js\nrun();\n```";
    const scribe = boot({ content });
    expect(scribe.editor.focusWidget("scribecli.code:0")).toBe(true);
    expect(scribe.editor.handleInput(key("Enter"))).toBe(true);
    expect(scribe.getContent()).toBe(content);
    expect(scribe.editor.output().widgets).toEqual([]);
    expect(scribe.editor.snapshot().selection.head).toEqual({
      paragraph: 2,
      offset: 3,
    });
  });

  it("hands table previews back to exact raw source", () => {
    const content = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const scribe = boot({ content });
    expect(scribe.editor.focusWidget("scribecli.table:0")).toBe(true);
    expect(scribe.editor.handleInput(key("Enter"))).toBe(true);
    expect(scribe.getContent()).toBe(content);
    expect(scribe.editor.output().widgets).toEqual([]);
  });

  it("keeps table source stable while adding a row below it", () => {
    const table = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const scribe = boot({ content: `before\n${table}\n` });
    const caret = { paragraph: 4, offset: 0 };
    scribe.editor.dispatch(
      scribe.editor.createTransaction().setSelection({
        anchor: caret,
        head: caret,
      }).build(),
    );

    expect(scribe.editor.output().widgets).toEqual([]);
    for (const character of "| 3 | 4 |") {
      scribe.editor.handleInput({ kind: "text", text: character });
      expect(scribe.editor.output().widgets).toEqual([]);
    }
    expect(scribe.getContent()).toBe(`before\n${table}\n| 3 | 4 |`);

    const before = { paragraph: 0, offset: 0 };
    scribe.editor.dispatch(
      scribe.editor.createTransaction().setSelection({
        anchor: before,
        head: before,
      }).build(),
    );
    expect(scribe.editor.output().widgets.map((widget) => widget.key)).toEqual([
      "scribecli.table:7",
    ]);
  });

  it("supports runtime source, focus, read, and edit policies", () => {
    const content = "# One.\n\nParagraph two.";
    const scribe = boot({ content });
    scribe.setPresentationMode("source");
    expect(scribe.editor.output().decorations.some(
      (decoration) => decoration.kind === "conceal",
    )).toBe(false);

    scribe.setPresentationMode("focus");
    expect(scribe.editor.output().decorations).toContainEqual({
      kind: "inline",
      from: 6,
      to: content.length,
      style: { role: "focusInactive", dim: true },
    });

    const caret = { paragraph: 2, offset: 4 };
    scribe.editor.dispatch(
      scribe.editor.createTransaction().setSelection({
        anchor: caret,
        head: caret,
      }).build(),
    );
    expect(scribe.editor.output().decorations).toContainEqual({
      kind: "inline",
      from: 0,
      to: 6,
      style: { role: "focusInactive", dim: true },
    });
    expect(scribe.editor.output().decorations.some(
      (decoration) =>
        decoration.kind === "inline" &&
        decoration.style.role === "focusInactive" &&
        decoration.from < 12 &&
        decoration.to > 12,
    )).toBe(false);

    scribe.setPresentationMode("read");
    expect(scribe.editor.snapshot().readOnly).toBe(true);
    scribe.setPresentationMode("edit");
    expect(scribe.editor.snapshot().readOnly).toBe(false);
  });

  it("keeps only the active sentence unmuted in Focus mode", () => {
    const content = "One. Two here. Three.";
    const scribe = boot({
      content,
      markdown: { mode: "focus" },
    });
    const caret = { paragraph: 0, offset: 6 };
    scribe.editor.dispatch(
      scribe.editor.createTransaction().setSelection({
        anchor: caret,
        head: caret,
      }).build(),
    );

    expect(scribe.editor.output().decorations).toEqual(
      expect.arrayContaining([
        {
          kind: "inline",
          from: 0,
          to: 4,
          style: { role: "focusInactive", dim: true },
        },
        {
          kind: "inline",
          from: 14,
          to: content.length,
          style: { role: "focusInactive", dim: true },
        },
      ]),
    );
    expect(scribe.editor.output().decorations.some(
      (decoration) =>
        decoration.kind === "inline" &&
        decoration.style.role === "focusInactive" &&
        decoration.from < 8 &&
        decoration.to > 8,
    )).toBe(false);
  });

  it("emits typed link activation effects without opening URLs", () => {
    const onLinkActivate = vi.fn();
    const content = "[Saturn](https://saturn9.studio)";
    const scribe = boot({
      content,
      markdown: { onLinkActivate },
    });
    scribe.editor.dispatch(
      scribe.editor
        .createTransaction()
        .setSelection({
          anchor: { paragraph: 0, offset: 3 },
          head: { paragraph: 0, offset: 3 },
        })
        .build(),
    );
    expect(scribe.editor.handleInput(key("Enter", { ctrl: true }))).toBe(true);
    expect(onLinkActivate).toHaveBeenCalledWith({
      type: "activateLink",
      url: "https://saturn9.studio",
      text: "Saturn",
      title: undefined,
    });
  });

  it("keeps unsupported fenced content as editable source", () => {
    const content = "```unknown\nnot closed";
    const scribe = boot({ content });
    expect(scribe.editor.output().widgets).toEqual([]);
    expect(scribe.editor.snapshot().syntax).toEqual(
      expect.objectContaining({
        kind: "scribecli-markdown",
        source: content,
      }),
    );
    expect(flowCliMarkdownParser).toBeDefined();
  });

  it("uses the first fence info token as the code language", () => {
    const content = "```ts title=example\nconst value = 1;\n```\n\nafter";
    const widgets = createMarkdownBlockWidgets(
      documentFromText(content),
      {
        anchor: { paragraph: 4, offset: 0 },
        head: { paragraph: 4, offset: 0 },
      },
      content,
    );

    expect(widgets[0]?.props).toEqual({ language: "ts" });
  });
});

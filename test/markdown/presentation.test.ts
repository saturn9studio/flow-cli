import { describe, expect, it } from "vitest";
import type { EditorDecoration } from "../../src/engine/index.js";
import { boot, flowCliDarkTheme } from "../../src/markdown/index.js";

const setCaret = (
  editor: ReturnType<typeof boot>["editor"],
  paragraph: number,
  offset: number,
): void => {
  editor.dispatch(
    editor.createTransaction().setSelection({
      anchor: { paragraph, offset },
      head: { paragraph, offset },
    }).build(),
  );
};

const presentation = (decorations: readonly EditorDecoration[]) =>
  decorations.filter((decoration) =>
    decoration.kind === "conceal" || decoration.kind === "replace",
  );

const renderedRows = (editor: ReturnType<typeof boot>["editor"]): string[] =>
  editor.frame(80, 12).rows.map((row) =>
    row.cells.filter((cell) => !cell.continuation).map((cell) => cell.text).join(""),
  );

describe("Markdown presentation", () => {
  it("conceals inactive strong markers and reveals the complete active construct", () => {
    const scribe = boot({ content: "**bold** plain" });
    setCaret(scribe.editor, 0, 14);

    expect(presentation(scribe.editor.output().decorations)).toEqual([
      { kind: "conceal", from: 0, to: 2 },
      { kind: "conceal", from: 6, to: 8 },
    ]);

    setCaret(scribe.editor, 0, 4);
    expect(presentation(scribe.editor.output().decorations)).toEqual([]);
  });

  it("renders headings, list bullets, links, quotes, and separators source-safely", () => {
    const content = "# Heading\n- item\n[link](https://example.com)\n> quote\n---";
    const scribe = boot({ content });
    setCaret(scribe.editor, 2, 4);

    const rows = renderedRows(scribe.editor).join("\n");
    expect(rows).toContain("Heading");
    expect(rows).toContain("• item");
    expect(rows).toContain("[link](https://example.com)");
    expect(rows).toContain("│ quote");
    expect(rows).toContain("────────");
    const frame = scribe.editor.frame(80, 12);
    expect(frame.rows[1]?.cells.find((cell) => cell.text === "•")?.style.role)
      .toBe("markdownListMarker");
    expect(frame.rows[3]?.cells[0]?.style.role).toBe("markdownQuoteMarker");
    expect(frame.rows[3]?.cells.find((cell) => cell.text === "q")?.style.role)
      .toBe("markdownQuote");
    expect(scribe.getContent()).toBe(content);
  });

  it("styles source without concealment in source mode", () => {
    const scribe = boot({
      content: "# **Heading**",
      markdown: { mode: "source" },
    });
    setCaret(scribe.editor, 0, 13);

    expect(presentation(scribe.editor.output().decorations)).toEqual([]);
    expect(renderedRows(scribe.editor).join("\n")).toContain("# **Heading**");
  });

  it("preserves blockquote backgrounds and nested markers in every mode", () => {
    for (const mode of ["edit", "read", "source"] as const) {
      const scribe = boot({
        content: "> > nested",
        markdown: { mode },
      });

      setCaret(scribe.editor, 0, 0);

      const row = scribe.editor.frame(80, 2).rows[0]!;
      expect(row.backgroundRole).toBe("markdownQuote");
      expect(row.cells.every((cell) =>
        cell.style.backgroundRole === "markdownQuote"
      )).toBe(true);
      if (mode === "read") {
        expect(row.cells.filter((cell) =>
          cell.style.role === "markdownQuoteMarker"
        )).toHaveLength(2);
      }
      scribe.destroy();
    }
  });

  it("preserves the blockquote background on an empty quote's space", () => {
    for (const mode of ["edit", "read", "source"] as const) {
      const scribe = boot({
        content: "> ",
        markdown: { mode },
      });
      setCaret(scribe.editor, 0, 2);

      const row = scribe.editor.frame(80, 2).rows[0]!;
      expect(row.cells.find((cell) => cell.text === " ")?.style).toMatchObject({
        role: "markdownQuote",
        backgroundRole: "markdownQuote",
      });
      scribe.destroy();
    }
  });

  it("uses the blockquote background for inline and fenced code", () => {
    expect(flowCliDarkTheme.roles.markdownCode?.background).toBe(
      flowCliDarkTheme.roles.markdownQuote?.background,
    );

    const scribe = boot({
      content: "plain\n`inline`\n```ts\nconst value = 1;\n```",
    });
    setCaret(scribe.editor, 0, 0);
    const frame = scribe.editor.frame(80, 8);
    const codeBlockRow = frame.rows.find((row) =>
      row.cells.some((cell) => cell.style.role?.startsWith("codeSyntax."))
    );

    expect(
      frame.rows.flatMap((row) => row.cells)
        .find((cell) => cell.style.role === "markdownCode"),
    ).toBeDefined();
    expect(codeBlockRow?.backgroundRole).toBe("markdownCode");
    expect(codeBlockRow?.cells.every((cell) =>
      cell.style.backgroundRole === "markdownCode"
    )).toBe(true);
    scribe.destroy();
  });

  it("keeps active code and math source rows on the code background", () => {
    for (const content of [
      "```python\n\ndef X(): pass\n```",
      "$$\n\n\\frac{a}{b} = c\n$$",
    ]) {
      const scribe = boot({ content });
      setCaret(scribe.editor, 2, 0);
      const rows = scribe.editor.frame(80, 6).rows.slice(0, 4);

      expect(rows.map((row) => row.backgroundRole)).toEqual([
        "markdownCode",
        "markdownCode",
        "markdownCode",
        "markdownCode",
      ]);
      expect(rows[0]?.cells.filter((cell) => cell.text !== "").every((cell) =>
        cell.style.backgroundRole === "markdownCode"
      )).toBe(true);
      expect(rows[0]?.cells[0]?.style.role).toBe("markdownCodeMarkup");
      expect(rows[1]?.cells).toEqual([]);
      expect(rows[2]?.cells.some((cell) =>
        cell.style.role === "codeSyntax.keyword"
      )).toBe(true);
      expect(rows[3]?.cells.filter((cell) => cell.text !== "").every((cell) =>
        cell.style.backgroundRole === "markdownCode"
      )).toBe(true);
      expect(rows[3]?.cells[0]?.style.role).toBe("markdownCodeMarkup");
      scribe.destroy();
    }
  });

  it("styles inline math like code and protects math blocks from inline markup", () => {
    const content = "Inline $E = mc^2$ math\n\n$$\n**literal**\n$$";
    const scribe = boot({ content });
    setCaret(scribe.editor, 4, 2);

    const decorations = scribe.editor.output().decorations;
    const inlineOpen = content.indexOf("$E");
    const inlineClose = content.indexOf("$", inlineOpen + 1);
    expect(presentation(decorations)).toEqual(expect.arrayContaining([
      { kind: "conceal", from: inlineOpen, to: inlineOpen + 1 },
      { kind: "conceal", from: inlineClose, to: inlineClose + 1 },
    ]));
    expect(decorations).toContainEqual({
      kind: "inline",
      from: inlineOpen + 1,
      to: inlineClose,
      style: { role: "markdownCode" },
    });
    expect(decorations.some((decoration) =>
      decoration.kind === "inline" &&
      decoration.style.role === "markdownStrong" &&
      decoration.from >= content.indexOf("**literal**")
    )).toBe(false);
    scribe.destroy();
  });

  it("does not produce overlapping concealment and replacements", () => {
    const scribe = boot({
      content: "# **Heading**\n- *item*\n![cover](cover.png)\n[link](url)",
    });
    setCaret(scribe.editor, 3, 11);
    const ranges = presentation(scribe.editor.output().decorations)
      .map((decoration) => ({ from: decoration.from, to: decoration.to }))
      .sort((a, b) => a.from - b.from || a.to - b.to);

    ranges.forEach((range, index) => {
      const previous = ranges[index - 1];
      if (previous) expect(range.from).toBeGreaterThanOrEqual(previous.to);
    });
  });

  it("does not decorate Markdown-looking text inside fenced code", () => {
    const content = "```md\n**literal** [link](url)\n```\nplain";
    const scribe = boot({ content });
    setCaret(scribe.editor, 3, 5);

    const decorations = scribe.editor.output().decorations;
    const presentationRanges = presentation(decorations);
    expect(presentationRanges).toHaveLength(2);
    expect(presentationRanges.map((decoration) =>
      content.slice(decoration.from, decoration.to),
    )).toEqual(["```", "```"]);
    expect(
      decorations.some((decoration) =>
        decoration.kind === "inline" &&
        decoration.from === 7 &&
        decoration.style.role === "markdownStrong",
      ),
    ).toBe(false);
  });
});

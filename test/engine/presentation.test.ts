import { describe, expect, it } from "vitest";
import {
  TerminalEditor,
  documentFromText,
  displayWidth,
  layoutDocument,
  positionAtVisualPoint,
  visualPointForPosition,
  widgetAtVisualPoint,
  type WidgetDecoration,
} from "../../src/engine/index.js";

describe("presentation projection", () => {
  it("conceals source while mapping both source boundaries to one visual point", () => {
    const doc = documentFromText("**bold**");
    const layout = layoutDocument(doc, {
      width: 20,
      decorations: [
        { kind: "conceal", from: 0, to: 2 },
        { kind: "conceal", from: 6, to: 8 },
      ],
    });

    expect(layout.rows[0].cells.filter((cell) => !cell.continuation).map((cell) => cell.text).join(""))
      .toBe("bold");
    expect(visualPointForPosition(doc, layout, { paragraph: 0, offset: 0 }))
      .toEqual({ row: 0, column: 0 });
    expect(visualPointForPosition(doc, layout, { paragraph: 0, offset: 2 }))
      .toEqual({ row: 0, column: 0 });
    expect(positionAtVisualPoint(doc, layout, 0, 0)).toEqual({ paragraph: 0, offset: 0 });
  });

  it("replaces source text without changing the document", () => {
    const editor = new TerminalEditor({ content: "- item" });
    const layout = layoutDocument(editor.snapshot().doc, {
      width: 20,
      decorations: [
        { kind: "replace", from: 0, to: 1, text: "•", style: { role: "accent" } },
      ],
    });
    expect(layout.rows[0].cells.filter((cell) => !cell.continuation).map((cell) => cell.text).join(""))
      .toBe("• item");
    expect(editor.snapshot().content).toBe("- item");
  });

  it("applies later overlays to replacement text", () => {
    const doc = documentFromText("- item");
    const layout = layoutDocument(doc, {
      width: 20,
      decorations: [
        {
          kind: "replace",
          from: 0,
          to: 1,
          text: "•",
          style: { role: "marker" },
        },
        {
          kind: "inline",
          from: 0,
          to: 6,
          style: { role: "inactive", dim: true },
        },
        {
          kind: "line",
          from: 0,
          to: 6,
          backgroundRole: "quote",
        },
      ],
    });

    expect(layout.rows[0]?.cells[0]?.style).toEqual({
      role: "inactive",
      dim: true,
      backgroundRole: "quote",
    });
  });

  it("preserves line backgrounds through wrapping and selection", () => {
    const doc = documentFromText("abcdef");
    const layout = layoutDocument(doc, {
      width: 3,
      selectionFrom: 0,
      selectionTo: 6,
      decorations: [{
        kind: "line",
        from: 0,
        to: 6,
        backgroundRole: "quote",
      }],
    });

    expect(layout.rows).toHaveLength(2);
    expect(layout.rows.map((row) => row.backgroundRole))
      .toEqual(["quote", "quote"]);
    expect(layout.rows.flatMap((row) => row.cells).every((cell) =>
      cell.style.role === "selection" &&
      cell.style.backgroundRole === "quote"
    )).toBe(true);
  });

  it("preserves line backgrounds on empty rows created by newlines", () => {
    const doc = documentFromText("one\n\nthree");
    const layout = layoutDocument(doc, {
      width: 20,
      decorations: [{
        kind: "line",
        from: 0,
        to: doc.paragraphs.map((paragraph) => paragraph.text).join("\n").length,
        backgroundRole: "quote",
      }],
    });

    expect(layout.rows.map((row) => row.backgroundRole))
      .toEqual(["quote", "quote", "quote"]);
    expect(layout.rows[1]?.cells).toEqual([]);
  });

  it("maps concealed source at its actual visual boundary", () => {
    const doc = documentFromText("before **bold");
    const layout = layoutDocument(doc, {
      width: 30,
      decorations: [{ kind: "conceal", from: 7, to: 9 }],
    });
    expect(visualPointForPosition(doc, layout, { paragraph: 0, offset: 7 }))
      .toEqual({ row: 0, column: 7 });
    expect(visualPointForPosition(doc, layout, { paragraph: 0, offset: 9 }))
      .toEqual({ row: 0, column: 7 });
  });

  it("renders block widgets while preserving source", () => {
    const doc = documentFromText("| A | B |\n| - | - |\n| 1 | 2 |");
    const widget: WidgetDecoration = {
      key: "test:table",
      placement: "block",
      range: {
        from: { paragraph: 0, offset: 0 },
        to: { paragraph: 2, offset: 9 },
      },
      props: {},
      selection: "block",
      render: {
        render: () => ({ lines: ["+---+---+", "| A | B |", "+---+---+"] }),
      },
    };
    const layout = layoutDocument(doc, { width: 20, widgets: [widget] });
    expect(layout.rows.slice(0, 3).map((row) => row.cells.map((cell) => cell.text).join("")))
      .toEqual(["+---+---+", "| A | B |", "+---+---+"]);
    expect(layout.rows.map((row) => row.cells.map((cell) => cell.text).join("")))
      .not.toContain("| - | - |");
    expect(doc.paragraphs[0].text).toBe("| A | B |");
  });

  it("projects native graphics onto their block widget fallback", () => {
    const doc = documentFromText("image");
    const widget: WidgetDecoration = {
      key: "test:image",
      placement: "block",
      range: {
        from: { paragraph: 0, offset: 0 },
        to: { paragraph: 0, offset: 5 },
      },
      props: {},
      selection: "block",
      render: {
        render: () => ({
          lines: ["....", "...."],
          graphic: {
            format: "rgba",
            width: 1,
            height: 1,
            data: Uint8Array.from([255, 0, 0, 255]),
          },
        }),
      },
    };

    const layout = layoutDocument(doc, {
      width: 20,
      widgets: [widget],
      decorations: [{
        kind: "line",
        from: 0,
        to: 5,
        backgroundRole: "quote",
      }],
    });
    expect(layout.graphics).toEqual([
      expect.objectContaining({
        key: "test:image",
        row: 0,
        column: 0,
        columns: 4,
        rows: 2,
      }),
    ]);
    expect(layout.rows.map((row) => row.backgroundRole))
      .toEqual(["quote", "quote"]);
    expect(layout.rows.flatMap((row) => row.cells).every((cell) =>
      cell.style.backgroundRole === "quote"
    )).toBe(true);
  });

  it("renders inline widgets in place of their source", () => {
    const doc = documentFromText("before [x] after");
    const widget: WidgetDecoration = {
      key: "test:checkbox",
      placement: "inline",
      range: {
        from: { paragraph: 0, offset: 7 },
        to: { paragraph: 0, offset: 10 },
      },
      props: {},
      selection: "atom",
      render: { render: () => ({ lines: ["☑"] }) },
    };
    const layout = layoutDocument(doc, {
      width: 30,
      widgets: [widget],
      decorations: [{
        kind: "line",
        from: 0,
        to: 17,
        backgroundRole: "quote",
      }],
    });
    expect(layout.rows[0].cells.filter((cell) => !cell.continuation).map((cell) => cell.text).join(""))
      .toBe("before ☑ after");
    expect(widgetAtVisualPoint(layout, 0, 7)?.key).toBe("test:checkbox");
    expect(layout.rows[0]?.cells[7]?.style.backgroundRole).toBe("quote");
    expect(widgetAtVisualPoint(layout, 0, 6)).toBeUndefined();
  });

  it("rejects multiline output from inline widget renderers", () => {
    const doc = documentFromText("source");
    const widget: WidgetDecoration = {
      key: "test:multiline-inline",
      placement: "inline",
      range: {
        from: { paragraph: 0, offset: 0 },
        to: { paragraph: 0, offset: 6 },
      },
      props: {},
      render: { render: () => ({ lines: ["one", "two"] }) },
      selection: "atom",
    };

    expect(() => layoutDocument(doc, { width: 20, widgets: [widget] }))
      .toThrow("inline widgets must render at most one line");
  });

  it("wraps wide graphemes without splitting continuation cells", () => {
    const doc = documentFromText("ab界c");
    const layout = layoutDocument(doc, { width: 3 });
    expect(layout.rows).toHaveLength(2);
    expect(layout.rows[0].cells.map((cell) => cell.text).join(""))
      .toBe("ab");
    expect(layout.rows[1].cells[0].text).toBe("界");
    expect(layout.rows[1].cells[1].continuation).toBe(true);
  });

  it("supports narrow and wide East Asian ambiguous-width policies", () => {
    expect(displayWidth("·Ω", 1)).toBe(2);
    expect(displayWidth("·Ω", 2)).toBe(4);
    const narrow = layoutDocument(documentFromText("··"), {
      width: 3,
      ambiguousWidth: 1,
    });
    const wide = layoutDocument(documentFromText("··"), {
      width: 3,
      ambiguousWidth: 2,
    });
    expect(narrow.rows).toHaveLength(1);
    expect(wide.rows).toHaveLength(2);
  });
});

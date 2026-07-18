import { describe, expect, it } from "vitest";
import { boot } from "../../src/markdown/index.js";

const selectOffsets = (
  flowEditor: ReturnType<typeof boot>,
  from: number,
  to: number,
): void => {
  flowEditor.editor.dispatch(
    flowEditor.editor
      .createTransaction()
      .setSelection({
        anchor: { paragraph: 0, offset: from },
        head: { paragraph: 0, offset: to },
      })
      .build(),
  );
};

describe("Flow CLI formatting helpers", () => {
  it("checks, applies, updates, and removes links", () => {
    const flowEditor = boot({ content: "Saturn" });
    selectOffsets(flowEditor, 0, 6);
    expect(flowEditor.executeLink({ action: "check" })).toEqual({
      isLink: false,
      text: "Saturn",
      url: "",
      title: "",
    });
    expect(
      flowEditor.executeLink({
        action: "apply",
        url: "https://saturn9.studio",
        title: "Studio",
      }),
    ).toBe(true);
    expect(flowEditor.getContent()).toBe(
      '[Saturn](https://saturn9.studio "Studio")',
    );
    expect(flowEditor.executeLink({ action: "remove" })).toBe(true);
    expect(flowEditor.getContent()).toBe("Saturn");
  });

  it("applies, selects, and removes images", () => {
    const flowEditor = boot();
    expect(
      flowEditor.executeImage({
        action: "apply",
        src: "cover.png",
        alt: "Cover",
      }),
    ).toBe(true);
    expect(flowEditor.getContent()).toBe("![Cover](cover.png)");
    expect(flowEditor.executeImage({ action: "check" })).toEqual({
      isImage: true,
      src: "cover.png",
      alt: "Cover",
      title: "",
    });
    expect(flowEditor.executeImage({ action: "select" })).toBe(true);
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 19 },
    });
    expect(flowEditor.executeImage({ action: "remove" })).toBe(true);
    expect(flowEditor.getContent()).toBe("");
  });

  it("applies colored highlights and removes their source markers", () => {
    const flowEditor = boot({ content: "important" });
    selectOffsets(flowEditor, 0, 9);
    expect(
      flowEditor.executeHighlightColor({ action: "apply", color: "blue" }),
    ).toBe(true);
    expect(flowEditor.getContent()).toBe("==🟦important==");
    expect(flowEditor.executeHighlightColor({ action: "check" })).toMatchObject({
      isHighlight: true,
      color: "blue",
      text: "important",
    });
    expect(flowEditor.executeHighlightColor({ action: "remove" })).toBe(true);
    expect(flowEditor.getContent()).toBe("important");
  });

  it("applies a colored highlight to the word at a collapsed caret", () => {
    const flowEditor = boot({ content: "important text" });
    selectOffsets(flowEditor, 2, 2);

    expect(
      flowEditor.executeHighlightColor({ action: "apply", color: "blue" }),
    ).toBe(true);
    expect(flowEditor.getContent()).toBe("==🟦important== text");
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 6 },
      head: { paragraph: 0, offset: 6 },
    });
  });

  it("applies and removes colored highlights across paragraphs", () => {
    const flowEditor = boot({ content: "one\ntwo" });
    flowEditor.editor.dispatch(
      flowEditor.editor.createTransaction().setSelection({
        anchor: { paragraph: 0, offset: 0 },
        head: { paragraph: 1, offset: 3 },
      }).build(),
    );

    expect(
      flowEditor.executeHighlightColor({ action: "apply", color: "blue" }),
    ).toBe(true);
    expect(flowEditor.getContent()).toBe("==🟦one==\n==🟦two==");
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 4 },
      head: { paragraph: 1, offset: 7 },
    });

    expect(flowEditor.executeHighlightColor({ action: "remove" })).toBe(true);
    expect(flowEditor.getContent()).toBe("one\ntwo");
  });

  it("removes a colored highlight whose selection includes boundary spaces", () => {
    const flowEditor = boot({ content: "a word b" });
    selectOffsets(flowEditor, 1, 7);

    expect(
      flowEditor.executeHighlightColor({ action: "apply", color: "blue" }),
    ).toBe(true);
    expect(flowEditor.getContent()).toBe("a==🟦 word ==b");
    expect(flowEditor.executeHighlightColor({ action: "remove" })).toBe(true);
    expect(flowEditor.getContent()).toBe("a word b");
  });

  it("removes a colored highlight contained by a larger selection", () => {
    const flowEditor = boot({ content: "before ==🟦marked== after" });
    selectOffsets(flowEditor, 0, 25);

    expect(flowEditor.executeHighlightColor({ action: "remove" })).toBe(true);
    expect(flowEditor.getContent()).toBe("before marked after");
  });

  it("does not remove an adjacent highlight from a collapsed caret", () => {
    const flowEditor = boot({ content: "==🟦marked==next" });
    selectOffsets(flowEditor, 14, 14);

    expect(flowEditor.executeHighlightColor({ action: "remove" })).toBe(false);
    expect(flowEditor.getContent()).toBe("==🟦marked==next");
  });
});

import { describe, expect, it } from "vitest";
import { boot } from "../../src/markdown/index.js";

const selectOffsets = (
  scribe: ReturnType<typeof boot>,
  from: number,
  to: number,
): void => {
  scribe.editor.dispatch(
    scribe.editor
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
    const scribe = boot({ content: "Saturn" });
    selectOffsets(scribe, 0, 6);
    expect(scribe.executeLink({ action: "check" })).toEqual({
      isLink: false,
      text: "Saturn",
      url: "",
      title: "",
    });
    expect(
      scribe.executeLink({
        action: "apply",
        url: "https://saturn9.studio",
        title: "Studio",
      }),
    ).toBe(true);
    expect(scribe.getContent()).toBe(
      '[Saturn](https://saturn9.studio "Studio")',
    );
    expect(scribe.executeLink({ action: "remove" })).toBe(true);
    expect(scribe.getContent()).toBe("Saturn");
  });

  it("applies, selects, and removes images", () => {
    const scribe = boot();
    expect(
      scribe.executeImage({
        action: "apply",
        src: "cover.png",
        alt: "Cover",
      }),
    ).toBe(true);
    expect(scribe.getContent()).toBe("![Cover](cover.png)");
    expect(scribe.executeImage({ action: "check" })).toEqual({
      isImage: true,
      src: "cover.png",
      alt: "Cover",
      title: "",
    });
    expect(scribe.executeImage({ action: "select" })).toBe(true);
    expect(scribe.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 19 },
    });
    expect(scribe.executeImage({ action: "remove" })).toBe(true);
    expect(scribe.getContent()).toBe("");
  });

  it("applies colored highlights and removes their source markers", () => {
    const scribe = boot({ content: "important" });
    selectOffsets(scribe, 0, 9);
    expect(
      scribe.executeHighlightColor({ action: "apply", color: "blue" }),
    ).toBe(true);
    expect(scribe.getContent()).toBe("==🟦important==");
    expect(scribe.executeHighlightColor({ action: "check" })).toMatchObject({
      isHighlight: true,
      color: "blue",
      text: "important",
    });
    expect(scribe.executeHighlightColor({ action: "remove" })).toBe(true);
    expect(scribe.getContent()).toBe("important");
  });

  it("applies a colored highlight to the word at a collapsed caret", () => {
    const scribe = boot({ content: "important text" });
    selectOffsets(scribe, 2, 2);

    expect(
      scribe.executeHighlightColor({ action: "apply", color: "blue" }),
    ).toBe(true);
    expect(scribe.getContent()).toBe("==🟦important== text");
    expect(scribe.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 6 },
      head: { paragraph: 0, offset: 6 },
    });
  });

  it("applies and removes colored highlights across paragraphs", () => {
    const scribe = boot({ content: "one\ntwo" });
    scribe.editor.dispatch(
      scribe.editor.createTransaction().setSelection({
        anchor: { paragraph: 0, offset: 0 },
        head: { paragraph: 1, offset: 3 },
      }).build(),
    );

    expect(
      scribe.executeHighlightColor({ action: "apply", color: "blue" }),
    ).toBe(true);
    expect(scribe.getContent()).toBe("==🟦one==\n==🟦two==");
    expect(scribe.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 4 },
      head: { paragraph: 1, offset: 7 },
    });

    expect(scribe.executeHighlightColor({ action: "remove" })).toBe(true);
    expect(scribe.getContent()).toBe("one\ntwo");
  });

  it("removes a colored highlight whose selection includes boundary spaces", () => {
    const scribe = boot({ content: "a word b" });
    selectOffsets(scribe, 1, 7);

    expect(
      scribe.executeHighlightColor({ action: "apply", color: "blue" }),
    ).toBe(true);
    expect(scribe.getContent()).toBe("a==🟦 word ==b");
    expect(scribe.executeHighlightColor({ action: "remove" })).toBe(true);
    expect(scribe.getContent()).toBe("a word b");
  });

  it("removes a colored highlight contained by a larger selection", () => {
    const scribe = boot({ content: "before ==🟦marked== after" });
    selectOffsets(scribe, 0, 25);

    expect(scribe.executeHighlightColor({ action: "remove" })).toBe(true);
    expect(scribe.getContent()).toBe("before marked after");
  });

  it("does not remove an adjacent highlight from a collapsed caret", () => {
    const scribe = boot({ content: "==🟦marked==next" });
    selectOffsets(scribe, 14, 14);

    expect(scribe.executeHighlightColor({ action: "remove" })).toBe(false);
    expect(scribe.getContent()).toBe("==🟦marked==next");
  });
});

import { describe, expect, it } from "vitest";
import {
  createTransaction,
  documentFromText,
  documentToText,
  nextPosition,
  nextWordPosition,
  previousPosition,
  previousWordPosition,
} from "../../src/engine/index.js";

describe("document model", () => {
  it("normalizes line endings and preserves a trailing paragraph", () => {
    const doc = documentFromText("one\r\ntwo\r");
    expect(documentToText(doc)).toBe("one\ntwo\n");
    expect(doc.paragraphs).toHaveLength(3);
  });

  it("moves and deletes by grapheme cluster", () => {
    const doc = documentFromText("a👨‍👩‍👧b");
    const afterA = { paragraph: 0, offset: 1 };
    const afterEmoji = nextPosition(doc, afterA);
    expect(doc.paragraphs[0].text.slice(afterA.offset, afterEmoji.offset)).toBe("👨‍👩‍👧");
    expect(previousPosition(doc, afterEmoji)).toEqual(afterA);
  });

  it("moves by whitespace-delimited words across paragraph boundaries", () => {
    const doc = documentFromText("one  two\nthree");
    expect(nextWordPosition(doc, { paragraph: 0, offset: 0 }))
      .toEqual({ paragraph: 0, offset: 3 });
    expect(nextWordPosition(doc, { paragraph: 0, offset: 3 }))
      .toEqual({ paragraph: 0, offset: 8 });
    expect(nextWordPosition(doc, { paragraph: 0, offset: 8 }))
      .toEqual({ paragraph: 1, offset: 0 });
    expect(previousWordPosition(doc, { paragraph: 1, offset: 0 }))
      .toEqual({ paragraph: 0, offset: 8 });
    expect(previousWordPosition(doc, { paragraph: 0, offset: 8 }))
      .toEqual({ paragraph: 0, offset: 5 });
  });

  it("applies multiline replacement without mutating the source document", () => {
    const doc = documentFromText("hello world");
    const transaction = createTransaction(doc, {
      anchor: { paragraph: 0, offset: 6 },
      head: { paragraph: 0, offset: 11 },
    })
      .replaceSelection("terminal\neditor")
      .build();

    expect(documentToText(doc)).toBe("hello world");
    expect(documentToText(transaction.docAfter)).toBe("hello terminal\neditor");
    expect(transaction.selectionAfter.head).toEqual({ paragraph: 1, offset: 6 });
  });
});

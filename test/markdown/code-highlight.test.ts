import { describe, expect, it } from "vitest";
import { highlightCode } from "../../src/markdown/index.js";

describe("Flow CLI code highlighting", () => {
  it("emits semantic runs while preserving source text exactly", () => {
    const code = 'const value = "<tag>"; // note';
    const lines = highlightCode(code, "ts");

    expect(lines.flatMap((line) => line).map((run) => run.text).join(""))
      .toBe(code);
    expect(lines.flatMap((line) => line).map((run) => run.style?.role))
      .toEqual(expect.arrayContaining([
        "codeSyntax.keyword",
        "codeSyntax.string",
        "codeSyntax.comment",
      ]));
  });

  it("keeps unknown languages as semantic code text", () => {
    expect(highlightCode("some code", "not-a-language")).toEqual([
      [{ text: "some code", style: { role: "markdownCode" } }],
    ]);
  });
});

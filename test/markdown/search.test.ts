import { describe, expect, it } from "vitest";
import { boot, searchPluginId } from "../../src/markdown/index.js";

describe("Flow CLI search and replace", () => {
  it("finds, navigates, and clears source matches", () => {
    const scribe = boot({ content: "One one ONE" });
    expect(
      scribe.executeFind({ action: "find", searchText: "one" }),
    ).toMatchObject({ totalMatches: 3, currentMatchIndex: 0 });
    expect(scribe.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 3 },
    });
    expect(scribe.executeFind({ action: "next" }).currentMatchIndex).toBe(1);
    expect(scribe.executeFind({ action: "previous" }).currentMatchIndex).toBe(0);
    expect(scribe.executeFind({ action: "clear" }).totalMatches).toBe(0);
  });

  it("preserves case sensitivity while matches update after edits", () => {
    const scribe = boot({ content: "One one" });
    expect(
      scribe.executeFind({
        action: "find",
        searchText: "One",
        caseSensitive: true,
      }).totalMatches,
    ).toBe(1);
    scribe.editor.handleInput({ kind: "text", text: "x" });
    expect(scribe.editor.getPluginState(searchPluginId)).toMatchObject({
      query: "One",
      caseSensitive: true,
      matches: [],
    });
  });

  it("replaces the active match and all matches transactionally", () => {
    const scribe = boot({ content: "cat cat cat" });
    scribe.executeFind({ action: "find", searchText: "cat" });
    expect(
      scribe.executeReplace({
        action: "replace",
        searchText: "cat",
        replaceText: "dog",
      }),
    ).toMatchObject({ replacements: 1, totalMatches: 2 });
    expect(scribe.getContent()).toBe("dog cat cat");
    expect(
      scribe.executeReplace({
        action: "replaceAll",
        searchText: "cat",
        replaceText: "fox",
      }),
    ).toMatchObject({ replacements: 2, totalMatches: 0 });
    expect(scribe.getContent()).toBe("dog fox fox");
    expect(scribe.editor.execute("editor.undo")).toBe(true);
    expect(scribe.getContent()).toBe("dog cat cat");
  });

  it("does not replace source in read-only editors", () => {
    const scribe = boot({ content: "cat", readOnly: true });
    expect(
      scribe.executeReplace({
        action: "replaceAll",
        searchText: "cat",
        replaceText: "dog",
      }).replacements,
    ).toBe(0);
    expect(scribe.getContent()).toBe("cat");
  });
});

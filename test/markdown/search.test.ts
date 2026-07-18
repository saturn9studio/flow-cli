import { describe, expect, it } from "vitest";
import { boot, searchPluginId } from "../../src/markdown/index.js";

describe("Flow CLI search and replace", () => {
  it("finds, navigates, and clears source matches", () => {
    const flowEditor = boot({ content: "One one ONE" });
    expect(
      flowEditor.executeFind({ action: "find", searchText: "one" }),
    ).toMatchObject({ totalMatches: 3, currentMatchIndex: 0 });
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 3 },
    });
    expect(flowEditor.executeFind({ action: "next" }).currentMatchIndex).toBe(1);
    expect(flowEditor.executeFind({ action: "previous" }).currentMatchIndex).toBe(0);
    expect(flowEditor.executeFind({ action: "clear" }).totalMatches).toBe(0);
  });

  it("preserves case sensitivity while matches update after edits", () => {
    const flowEditor = boot({ content: "One one" });
    expect(
      flowEditor.executeFind({
        action: "find",
        searchText: "One",
        caseSensitive: true,
      }).totalMatches,
    ).toBe(1);
    flowEditor.editor.handleInput({ kind: "text", text: "x" });
    expect(flowEditor.editor.getPluginState(searchPluginId)).toMatchObject({
      query: "One",
      caseSensitive: true,
      matches: [],
    });
  });

  it("replaces the active match and all matches transactionally", () => {
    const flowEditor = boot({ content: "cat cat cat" });
    flowEditor.executeFind({ action: "find", searchText: "cat" });
    expect(
      flowEditor.executeReplace({
        action: "replace",
        searchText: "cat",
        replaceText: "dog",
      }),
    ).toMatchObject({ replacements: 1, totalMatches: 2 });
    expect(flowEditor.getContent()).toBe("dog cat cat");
    expect(
      flowEditor.executeReplace({
        action: "replaceAll",
        searchText: "cat",
        replaceText: "fox",
      }),
    ).toMatchObject({ replacements: 2, totalMatches: 0 });
    expect(flowEditor.getContent()).toBe("dog fox fox");
    expect(flowEditor.editor.execute("editor.undo")).toBe(true);
    expect(flowEditor.getContent()).toBe("dog cat cat");
  });

  it("does not replace source in read-only editors", () => {
    const flowEditor = boot({ content: "cat", readOnly: true });
    expect(
      flowEditor.executeReplace({
        action: "replaceAll",
        searchText: "cat",
        replaceText: "dog",
      }).replacements,
    ).toBe(0);
    expect(flowEditor.getContent()).toBe("cat");
  });
});

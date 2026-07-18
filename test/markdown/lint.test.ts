import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyLintSuggestion,
  boot,
  createLintController,
  lintDecorationsPluginId,
  type LintResult,
} from "../../src/markdown/index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Flow CLI lint controller", () => {
  it("rejects stale asynchronous results", async () => {
    vi.useFakeTimers();
    const pending: Array<(result: readonly LintResult[]) => void> = [];
    const provider = vi.fn(
      () => new Promise<readonly LintResult[]>((resolve) => pending.push(resolve)),
    );
    const scribe = boot({ content: "first" });
    const controller = createLintController(scribe.editor, provider, {
      debounceMs: 10,
    });

    controller.run();
    await vi.advanceTimersByTimeAsync(10);
    scribe.editor.handleInput({ kind: "text", text: "x" });
    controller.run();
    await vi.advanceTimersByTimeAsync(10);
    pending[0]?.([{ from: 0, to: 1, message: "Stale" }]);
    await Promise.resolve();
    expect(scribe.editor.getPluginState(lintDecorationsPluginId)).toEqual([]);

    pending[1]?.([{ from: 0, to: 1, message: "Current" }]);
    await Promise.resolve();
    expect(scribe.editor.getPluginState(lintDecorationsPluginId)).toEqual([
      { from: 0, to: 1, message: "Current" },
    ]);
    controller.dispose();
  });

  it("reports provider failures and supports clearing", async () => {
    vi.useFakeTimers();
    const error = new Error("lint failed");
    const onError = vi.fn();
    const scribe = boot({ content: "text" });
    const controller = createLintController(
      scribe.editor,
      () => Promise.reject(error),
      { debounceMs: 0, onError },
    );
    controller.run();
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(error);
    controller.clear();
    expect(scribe.editor.getPluginState(lintDecorationsPluginId)).toEqual([]);
  });

  it("applies suggestions through ordinary editor history", () => {
    const scribe = boot({ content: "teh word" });
    expect(
      applyLintSuggestion(scribe.editor, { from: 0, to: 3 }, "the"),
    ).toBe(true);
    expect(scribe.getContent()).toBe("the word");
    expect(scribe.editor.execute("editor.undo")).toBe(true);
    expect(scribe.getContent()).toBe("teh word");
  });
});

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
    const flowEditor = boot({ content: "first" });
    const controller = createLintController(flowEditor.editor, provider, {
      debounceMs: 10,
    });

    controller.run();
    await vi.advanceTimersByTimeAsync(10);
    flowEditor.editor.handleInput({ kind: "text", text: "x" });
    controller.run();
    await vi.advanceTimersByTimeAsync(10);
    pending[0]?.([{ from: 0, to: 1, message: "Stale" }]);
    await Promise.resolve();
    expect(flowEditor.editor.getPluginState(lintDecorationsPluginId)).toEqual([]);

    pending[1]?.([{ from: 0, to: 1, message: "Current" }]);
    await Promise.resolve();
    expect(flowEditor.editor.getPluginState(lintDecorationsPluginId)).toEqual([
      { from: 0, to: 1, message: "Current" },
    ]);
    controller.dispose();
  });

  it("reports provider failures and supports clearing", async () => {
    vi.useFakeTimers();
    const error = new Error("lint failed");
    const onError = vi.fn();
    const flowEditor = boot({ content: "text" });
    const controller = createLintController(
      flowEditor.editor,
      () => Promise.reject(error),
      { debounceMs: 0, onError },
    );
    controller.run();
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(error);
    controller.clear();
    expect(flowEditor.editor.getPluginState(lintDecorationsPluginId)).toEqual([]);
  });

  it("applies suggestions through ordinary editor history", () => {
    const flowEditor = boot({ content: "teh word" });
    expect(
      applyLintSuggestion(flowEditor.editor, { from: 0, to: 3 }, "the"),
    ).toBe(true);
    expect(flowEditor.getContent()).toBe("the word");
    expect(flowEditor.editor.execute("editor.undo")).toBe(true);
    expect(flowEditor.getContent()).toBe("teh word");
  });
});

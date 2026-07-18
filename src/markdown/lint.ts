import {
  createTransaction,
  positionFromOffset,
  type TerminalEditor,
} from "../engine/index.js";
import { lintResultsMetaKey, type LintResult } from "./plugins.js";

export type LintProvider = (
  content: string,
) => readonly LintResult[] | Promise<readonly LintResult[]>;

export interface LintDictionary {
  add(word: string): void | Promise<void>;
}

export interface LintControllerOptions {
  readonly debounceMs?: number;
  readonly onError?: (error: unknown) => void;
}

export interface LintController {
  run(): void;
  clear(): void;
  dispose(): void;
}

export const dispatchLintResults = (
  editor: TerminalEditor,
  lints: readonly LintResult[],
): void => {
  const snapshot = editor.snapshot();
  editor.dispatch(
    createTransaction(snapshot.doc, snapshot.selection)
      .setMeta(lintResultsMetaKey, lints)
      .build(),
  );
};

export const applyLintSuggestion = (
  editor: TerminalEditor,
  lint: Pick<LintResult, "from" | "to">,
  replacement: string,
): boolean => {
  const snapshot = editor.snapshot();
  if (
    snapshot.readOnly ||
    lint.from < 0 ||
    lint.to <= lint.from ||
    lint.to > snapshot.content.length
  ) {
    return false;
  }
  editor.dispatch(
    createTransaction(snapshot.doc, snapshot.selection)
      .replaceRange(
        positionFromOffset(snapshot.doc, lint.from),
        positionFromOffset(snapshot.doc, lint.to),
        replacement,
      )
      .build(),
  );
  return true;
};

export const createLintController = (
  editor: TerminalEditor,
  provider: LintProvider,
  options: LintControllerOptions = {},
): LintController => {
  const debounceMs = options.debounceMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let request = 0;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  const runNow = () => {
    const requestId = ++request;
    const snapshot = editor.snapshot();
    void Promise.resolve(provider(snapshot.content))
      .then((lints) => {
        if (disposed || requestId !== request) return;
        const current = editor.snapshot();
        if (current.content !== snapshot.content) return;
        dispatchLintResults(editor, lints);
      })
      .catch((error: unknown) => {
        if (!disposed && requestId === request) options.onError?.(error);
      });
  };

  return {
    run() {
      clearTimer();
      timer = setTimeout(runNow, debounceMs);
    },
    clear() {
      clearTimer();
      request += 1;
      dispatchLintResults(editor, []);
    },
    dispose() {
      disposed = true;
      clearTimer();
      request += 1;
    },
  };
};

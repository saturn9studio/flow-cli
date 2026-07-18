import {
  createTransactionMetaKey,
  PluginId,
  normalizeRange,
  selectionIsCollapsed,
  textInRange,
  type EditorDecoration,
  type EditorDocument,
  type EditorPlugin,
  type Selection,
  type TextStyle,
  type WidgetRenderer,
} from "../engine/index.js";
import { checkHighlightColor, type HighlightColorResult } from "./highlight.js";
import { sentenceRangeAt } from "./focus.js";

export interface TextCount {
  readonly words: number;
  readonly characters: number;
}

export interface WordCount extends TextCount {
  readonly document: TextCount;
  readonly selection: TextCount | null;
  readonly isSelection: boolean;
}

export interface LintResult {
  readonly from: number;
  readonly to: number;
  readonly message: string;
  readonly category?: string;
  readonly suggestions?: readonly string[];
}

export interface HighlightMatch {
  readonly from: number;
  readonly to: number;
  readonly style?: TextStyle;
  readonly role?: string;
}

interface EmptyPluginState {
  readonly version: 0;
}

const emptyState: EmptyPluginState = { version: 0 };

export const placeholderPluginId =
  new PluginId<EmptyPluginState>("scribecli.placeholder");
export const documentChangedPluginId =
  new PluginId<EmptyPluginState>("scribecli.document-changed");
export const wordCountPluginId =
  new PluginId<WordCount>("scribecli.word-count");
export const currentSentencePluginId =
  new PluginId<EmptyPluginState>("scribecli.current-sentence");
export const highlightColorAffordancePluginId =
  new PluginId<HighlightColorResult>("scribecli.highlight-color-affordance");
export const lintDecorationsPluginId =
  new PluginId<readonly LintResult[]>("scribecli.lint-decorations");
export const textHighlightPluginId =
  new PluginId<readonly HighlightMatch[]>("scribecli.text-highlights");

const placeholderRenderer: WidgetRenderer<{ readonly text: string }> = {
  render: ({ props }) => ({
    lines: [[{ text: props.text, style: { role: "placeholder", dim: true } }]],
  }),
};

export const withPlaceholderText = (
  text: string,
): EditorPlugin<EmptyPluginState> => ({
  id: placeholderPluginId,
  init: () => emptyState,
  apply: () => emptyState,
  widgets: ({ content, doc }) =>
    content.length === 0 && doc.paragraphs.length === 1
      ? [{
          key: "scribecli.placeholder:empty",
          placement: "inline",
          range: {
            from: { paragraph: 0, offset: 0 },
            to: { paragraph: 0, offset: 0 },
          },
          props: { text },
          render: placeholderRenderer,
          selection: "inline",
        }]
      : [],
});

export const withDocumentChanged = (
  onChanged: (content: string) => void,
): EditorPlugin<EmptyPluginState> => ({
  id: documentChangedPluginId,
  init: () => emptyState,
  apply: ({ content, transaction }) => {
    if (transaction.displayChanges.length > 0) onChanged(content);
    return emptyState;
  },
});

export const countText = (content: string): TextCount => ({
  words: content.match(/\b[\p{L}\p{N}_']+\b/gu)?.length ?? 0,
  characters: content.length,
});

const createWordCount = (
  doc: EditorDocument,
  selection: Selection,
  content: string,
): WordCount => {
  const document = countText(content);
  const selectedText = selectionIsCollapsed(selection)
    ? ""
    : textInRange(doc, normalizeRange(selection));
  const selected = selectedText.length > 0 ? countText(selectedText) : null;
  return {
    ...(selected ?? document),
    document,
    selection: selected,
    isSelection: selected !== null,
  };
};

const sameCount = (left: TextCount | null, right: TextCount | null): boolean =>
  left === null || right === null
    ? left === right
    : left.words === right.words && left.characters === right.characters;

const sameWordCount = (left: WordCount, right: WordCount): boolean =>
  left.isSelection === right.isSelection &&
  sameCount(left, right) &&
  sameCount(left.document, right.document) &&
  sameCount(left.selection, right.selection);

export const withWordCount = (
  onCount: (count: WordCount) => void,
): EditorPlugin<WordCount> => ({
  id: wordCountPluginId,
  init: ({ doc, selection, content }) => {
    const count = createWordCount(doc, selection, content);
    onCount(count);
    return count;
  },
  apply: ({ doc, selection, content, state }) => {
    const count = createWordCount(doc, selection, content);
    if (!sameWordCount(count, state)) onCount(count);
    return count;
  },
});

export const withCurrentSentence = (): EditorPlugin<EmptyPluginState> => ({
  id: currentSentencePluginId,
  init: () => emptyState,
  apply: () => emptyState,
  decorations: ({ content, selection }) => {
    if (!selectionIsCollapsed(selection)) return [];
    const offset = content
      .split("\n")
      .slice(0, selection.head.paragraph)
      .reduce((total, line) => total + line.length + 1, selection.head.offset);
    const range = sentenceRangeAt(content, offset);
    return [{
      kind: "inline",
      ...range,
      style: { role: "currentSentence" },
    }];
  },
});

export const withHighlightColorAffordance = (
  onChange?: (state: HighlightColorResult) => void,
): EditorPlugin<HighlightColorResult> => ({
  id: highlightColorAffordancePluginId,
  init: (context) => {
    const state = checkHighlightColor(context);
    onChange?.(state);
    return state;
  },
  apply: (context) => {
    const state = checkHighlightColor(context);
    if (
      context.state.isHighlight !== state.isHighlight ||
      context.state.color !== state.color ||
      context.state.text !== state.text ||
      context.state.from !== state.from ||
      context.state.to !== state.to
    ) {
      onChange?.(state);
    }
    return state;
  },
  decorations: ({ state }) =>
    state.isHighlight
      ? [{
          kind: "inline",
          from: state.from,
          to: state.to,
          style: { role: `highlightAffordance.${state.color}`, underline: true },
        }]
      : [],
});

export const withLintDecorations = (
  lints: readonly LintResult[] = [],
): EditorPlugin<readonly LintResult[]> => ({
  id: lintDecorationsPluginId,
  init: () => lints,
  apply: ({ state, transaction }) => {
    const meta = transaction.meta.get(lintResultsMetaKey);
    if (meta) return meta;
    return transaction.displayChanges.length > 0 ? [] : state;
  },
  decorations: ({ state, content }): readonly EditorDecoration[] =>
    state
      .filter((lint) => lint.from >= 0 && lint.to <= content.length && lint.from < lint.to)
      .map((lint) => ({
        kind: "inline",
        from: lint.from,
        to: lint.to,
        style: {
          role: lint.category ? `lint.${lint.category}` : "lint",
          underline: true,
        },
      })),
});

export const withTextHighlights = (
  matcher: (content: string) => readonly HighlightMatch[],
): EditorPlugin<readonly HighlightMatch[]> => ({
  id: textHighlightPluginId,
  init: ({ content }) => matcher(content),
  apply: ({ content, transaction, state }) =>
    transaction.displayChanges.length > 0 ? matcher(content) : state,
  decorations: ({ state, content }): readonly EditorDecoration[] =>
    state
      .filter((match) => match.from >= 0 && match.to <= content.length && match.from < match.to)
      .map((match) => ({
        kind: "inline",
        from: match.from,
        to: match.to,
        style: match.style ?? { role: match.role ?? "textHighlight" },
      })),
});

export const lintResultsMetaKey =
  createTransactionMetaKey<readonly LintResult[]>("scribecli.lintResults");

import {
  createTransaction,
  createTransactionMetaKey,
  PluginId,
  positionFromOffset,
  type EditorPlugin,
  type TerminalEditor,
} from "../engine/index.js";

export interface SearchMatch {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export interface SearchState {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly matches: readonly SearchMatch[];
  readonly currentMatchIndex: number;
}

export interface FindCommandArgs {
  readonly action: "find" | "next" | "previous" | "clear";
  readonly searchText?: string;
  readonly caseSensitive?: boolean;
}

export interface FindResult extends SearchState {
  readonly totalMatches: number;
}

export interface ReplaceCommandArgs {
  readonly action: "replace" | "replaceAll";
  readonly searchText: string;
  readonly replaceText: string;
  readonly caseSensitive?: boolean;
}

export interface ReplaceResult extends FindResult {
  readonly replacements: number;
}

const emptySearchState: SearchState = {
  query: "",
  caseSensitive: false,
  matches: [],
  currentMatchIndex: -1,
};

export const searchPluginId = new PluginId<SearchState>("scribecli.search");
export const searchStateMetaKey =
  createTransactionMetaKey<SearchState>("scribecli.searchState");

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const findSearchMatches = (
  content: string,
  query: string,
  caseSensitive = false,
): readonly SearchMatch[] => {
  if (query.length === 0) return [];
  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? "gu" : "giu");
  return [...content.matchAll(pattern)].map((match) => ({
    from: match.index ?? 0,
    to: (match.index ?? 0) + match[0].length,
    text: match[0],
  }));
};

const stateForQuery = (
  content: string,
  query: string,
  caseSensitive: boolean,
  currentMatchIndex: number,
): SearchState => {
  const matches = findSearchMatches(content, query, caseSensitive);
  return {
    query,
    caseSensitive,
    matches,
    currentMatchIndex:
      matches.length === 0
        ? -1
        : Math.min(Math.max(currentMatchIndex, 0), matches.length - 1),
  };
};

const resultFromState = (state: SearchState): FindResult => ({
  ...state,
  totalMatches: state.matches.length,
});

const dispatchSearchState = (
  editor: TerminalEditor,
  state: SearchState,
): void => {
  const snapshot = editor.snapshot();
  const active = state.matches[state.currentMatchIndex];
  const transaction = createTransaction(snapshot.doc, snapshot.selection)
    .setMeta(searchStateMetaKey, state);
  if (active) {
    transaction.setSelection({
      anchor: positionFromOffset(snapshot.doc, active.from),
      head: positionFromOffset(snapshot.doc, active.to),
    });
  }
  editor.dispatch(transaction.build());
};

export const executeFindCommand = (
  editor: TerminalEditor,
  args: FindCommandArgs,
): FindResult => {
  if (args.action === "clear") {
    dispatchSearchState(editor, emptySearchState);
    return resultFromState(emptySearchState);
  }
  const previous = editor.getPluginState(searchPluginId) ?? emptySearchState;
  const query = args.searchText ?? previous.query;
  const caseSensitive = args.caseSensitive ?? previous.caseSensitive;
  const matches = findSearchMatches(editor.snapshot().content, query, caseSensitive);
  const currentMatchIndex =
    args.action === "find"
      ? matches.length > 0 ? 0 : -1
      : args.action === "next"
        ? matches.length > 0 ? (previous.currentMatchIndex + 1) % matches.length : -1
        : matches.length > 0
          ? (previous.currentMatchIndex - 1 + matches.length) % matches.length
          : -1;
  const state = { query, caseSensitive, matches, currentMatchIndex };
  dispatchSearchState(editor, state);
  return resultFromState(state);
};

export const executeReplaceCommand = (
  editor: TerminalEditor,
  args: ReplaceCommandArgs,
): ReplaceResult => {
  const snapshot = editor.snapshot();
  const caseSensitive = args.caseSensitive ?? false;
  const matches = findSearchMatches(
    snapshot.content,
    args.searchText,
    caseSensitive,
  );
  if (snapshot.readOnly || matches.length === 0) {
    const state = stateForQuery(
      snapshot.content,
      args.searchText,
      caseSensitive,
      -1,
    );
    dispatchSearchState(editor, state);
    return { ...resultFromState(state), replacements: 0 };
  }
  const previous = editor.getPluginState(searchPluginId) ?? emptySearchState;
  if (args.action === "replaceAll") {
    const transaction = createTransaction(snapshot.doc, snapshot.selection);
    [...matches].reverse().forEach((match) => {
      transaction.replaceRange(
        positionFromOffset(transaction.doc, match.from),
        positionFromOffset(transaction.doc, match.to),
        args.replaceText,
      );
    });
    editor.dispatch(transaction.build());
    dispatchSearchState(editor, emptySearchState);
    return { ...resultFromState(emptySearchState), replacements: matches.length };
  }
  const index =
    previous.currentMatchIndex >= 0
      ? Math.min(previous.currentMatchIndex, matches.length - 1)
      : 0;
  const target = matches[index] ?? matches[0];
  const transaction = createTransaction(snapshot.doc, snapshot.selection)
    .replaceRange(
      positionFromOffset(snapshot.doc, target.from),
      positionFromOffset(snapshot.doc, target.to),
      args.replaceText,
    );
  editor.dispatch(transaction.build());
  const content = editor.snapshot().content;
  const nextMatches = findSearchMatches(content, args.searchText, caseSensitive);
  const nextPosition = target.from + args.replaceText.length;
  let nextIndex = nextMatches.findIndex((match) => match.from >= nextPosition);
  if (nextIndex < 0 && nextMatches.length > 0) nextIndex = 0;
  const state: SearchState = {
    query: args.searchText,
    caseSensitive,
    matches: nextMatches,
    currentMatchIndex: nextIndex,
  };
  dispatchSearchState(editor, state);
  return { ...resultFromState(state), replacements: 1 };
};

export const withSearch = (): EditorPlugin<SearchState> => ({
  id: searchPluginId,
  init: () => emptySearchState,
  apply: ({ content, state, transaction }) => {
    const meta = transaction.meta.get(searchStateMetaKey);
    if (meta) return meta;
    return transaction.displayChanges.length > 0 && state.query.length > 0
      ? stateForQuery(
          content,
          state.query,
          state.caseSensitive,
          state.currentMatchIndex,
        )
      : state;
  },
  decorations: ({ state }) =>
    state.matches.map((match, index) => ({
      kind: "inline",
      from: match.from,
      to: match.to,
      style: {
        role: index === state.currentMatchIndex
          ? "searchMatchActive"
          : "searchMatch",
        inverse: index === state.currentMatchIndex,
        underline: true,
      },
    })),
});

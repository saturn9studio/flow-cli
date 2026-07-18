import {
  parseDocument,
  reparse,
  type Change,
  type ParseState,
  type Token,
} from "@saturn9/markoffset";
import type {
  DisplayChange,
  EditorDocument,
  SyntaxProvider,
  SyntaxSnapshot,
} from "../../engine/index.js";
import { documentToText } from "../../engine/index.js";
import { flowCliMarkdownParser } from "./parser.js";

export const markdownSyntaxKind = "scribecli-markdown";

export interface MarkdownSyntaxTokenView {
  readonly token: Token;
  readonly kind: string;
  readonly from: number;
  readonly to: number;
}

export interface MarkdownSyntaxSnapshot extends SyntaxSnapshot {
  readonly kind: typeof markdownSyntaxKind;
  readonly source: string;
  readonly parseState: ParseState;
  readonly tokens: readonly Token[];
  readonly tokenViews: readonly MarkdownSyntaxTokenView[];
}

export const isMarkdownSyntaxSnapshot = (
  syntax: SyntaxSnapshot,
): syntax is MarkdownSyntaxSnapshot =>
  syntax.kind === markdownSyntaxKind &&
  "source" in syntax &&
  "parseState" in syntax &&
  "tokenViews" in syntax;

export const requireMarkdownSyntaxSnapshot = (
  syntax: SyntaxSnapshot,
): MarkdownSyntaxSnapshot => {
  if (isMarkdownSyntaxSnapshot(syntax)) return syntax;
  throw new Error(`Expected Flow CLI Markdown syntax, received "${syntax.kind}"`);
};

const flattenBlockTokens = (tokens: readonly Token[]): readonly Token[] =>
  tokens.flatMap((token) => [
    token,
    ...(token.kind === "bullet_list" ||
    token.kind === "ordered_list" ||
    token.kind === "list_item"
      ? flattenBlockTokens(token.children ?? [])
      : []),
  ]);

const snapshotFromParseState = (
  source: string,
  parseState: ParseState,
  version: number,
): MarkdownSyntaxSnapshot => ({
  kind: markdownSyntaxKind,
  version,
  source,
  parseState,
  tokens: parseState.tokens,
  tokenViews: flattenBlockTokens(parseState.tokens).map((token) => ({
    token,
    kind: token.kind,
    from: token.start,
    to: token.end,
  })),
});

export const buildMarkdownSyntaxSnapshot = (
  doc: EditorDocument,
): MarkdownSyntaxSnapshot => {
  const source = documentToText(doc);
  return snapshotFromParseState(
    source,
    parseDocument(flowCliMarkdownParser, source),
    0,
  );
};

const displayChangeToMarkdownChange = (change: DisplayChange): Change => ({
  from: change.from,
  to: change.to,
  insert: change.insert.replace(/\r\n?/gu, "\n"),
});

export const updateMarkdownSyntaxSnapshot = (
  previous: MarkdownSyntaxSnapshot,
  doc: EditorDocument,
  displayChanges: readonly DisplayChange[],
): MarkdownSyntaxSnapshot => {
  if (displayChanges.length === 0) return previous;

  const source = documentToText(doc);
  const version = previous.version + 1;
  if (displayChanges.length !== 1) {
    return snapshotFromParseState(
      source,
      parseDocument(flowCliMarkdownParser, source),
      version,
    );
  }

  const parseState = reparse(
    flowCliMarkdownParser,
    previous.parseState,
    displayChangeToMarkdownChange(displayChanges[0]),
  );
  return parseState.src === source
    ? snapshotFromParseState(source, parseState, version)
    : snapshotFromParseState(
        source,
        parseDocument(flowCliMarkdownParser, source),
        version,
      );
};

export const markdownSyntaxProvider: SyntaxProvider = {
  create: buildMarkdownSyntaxSnapshot,
  update(previous, doc, displayChanges) {
    return updateMarkdownSyntaxSnapshot(
      requireMarkdownSyntaxSnapshot(previous),
      doc,
      displayChanges,
    );
  },
};

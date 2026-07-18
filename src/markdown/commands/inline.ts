import {
  createTransaction,
  normalizeRange,
  selectionIsCollapsed,
  type EditorCommandContext,
  type EditorDocument,
  type Position,
  type Range,
  type Selection,
} from "../../engine/index.js";
import {
  createParser,
  parseDocument,
  type BlockRule,
  type Token,
} from "@saturn9/markoffset";
import {
  flowCliMarkdownClosingFenceLine,
  flowCliMarkdownFencePrefix,
  flowCliMarkdownInlineRules,
} from "../presentation/parser.js";

const isWhitespace = (text: string): boolean => /\s/u.test(text);
const formattingMarker = /[*_~=`$]/u;

export type InlineFormattingKind =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "math"
  | "highlight";

export interface InlineFormattingSpec {
  readonly kind: InlineFormattingKind;
  readonly open: string;
  readonly close: string;
}

export const inlineFormattingSpecs = {
  bold: { kind: "bold", open: "**", close: "**" },
  italic: { kind: "italic", open: "*", close: "*" },
  underline: { kind: "underline", open: "~", close: "~" },
  strikethrough: { kind: "strikethrough", open: "~~", close: "~~" },
  code: { kind: "code", open: "`", close: "`" },
  math: { kind: "math", open: "$", close: "$" },
  highlight: { kind: "highlight", open: "==", close: "==" },
} as const satisfies Record<InlineFormattingKind, InlineFormattingSpec>;

interface ParagraphRange {
  readonly paragraph: number;
  readonly from: number;
  readonly to: number;
  readonly caret?: number;
}

interface InlineFormattingSpan {
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly open: string;
  readonly close: string;
}

interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly selectionAfter: boolean;
}

interface ParagraphTransform {
  readonly text: string;
  readonly mapOffset: (offset: number) => number;
}

const inlineParagraphRule: BlockRule = {
  name: "scribecli-inline-formatting",
  priority: 1000,
  inlineContent: true,
  match: () => true,
  parse(scanner) {
    const start = scanner.currentLineStart();
    const content = scanner.currentLine();
    const end = scanner.currentLineEnd();
    scanner.advance();
    return { kind: "paragraph", start, end, content };
  },
};

const inlineParser = createParser({
  block: [inlineParagraphRule],
  inline: flowCliMarkdownInlineRules,
});

const tokenBounds = (
  token: Token,
): { readonly from: number; readonly to: number } => {
  if (
    token.children &&
    token.children.length > 0 &&
    token.markup &&
    (token.kind === "strong" ||
      token.kind === "em" ||
      token.kind === "strikethrough")
  ) {
    const children = token.children.map(tokenBounds);
    return {
      from: Math.min(...children.map((child) => child.from)) - token.markup.length,
      to: Math.max(...children.map((child) => child.to)) + token.markup.length,
    };
  }
  return { from: token.start, to: token.end };
};

const tokenMatchesSpec = (
  token: Token,
  spec: InlineFormattingSpec,
): boolean => {
  switch (spec.kind) {
    case "bold":
      return token.kind === "strong";
    case "italic":
      return token.kind === "em";
    case "underline":
      return token.kind === "strikethrough" && token.markup === "~";
    case "strikethrough":
      return token.kind === "strikethrough" && token.markup === "~~";
    case "code":
      return token.kind === "code_inline";
    case "math":
      return token.kind === "math_inline";
    case "highlight":
      return false;
  }
};

const collectTokenSpans = (
  text: string,
  token: Token,
  spec: InlineFormattingSpec,
  spans: InlineFormattingSpan[],
): void => {
  if (tokenMatchesSpec(token, spec)) {
    const bounds = tokenBounds(token);
    let markerLength = token.markup?.length ?? spec.open.length;
    if (token.kind === "code_inline") {
      markerLength = 0;
      while (text[bounds.from + markerLength] === "`") markerLength += 1;
    }
    const open = token.kind === "code_inline"
      ? "`".repeat(Math.max(1, markerLength))
      : token.markup ?? spec.open;
    spans.push({
      from: bounds.from,
      to: bounds.to,
      contentFrom: bounds.from + open.length,
      contentTo: bounds.to - open.length,
      open,
      close: open,
    });
  }
  token.children?.forEach((child) =>
    collectTokenSpans(text, child, spec, spans)
  );
};

const highlightSpans = (text: string): readonly InlineFormattingSpan[] =>
  [...text.matchAll(/==(?:(?:🟩|🟥|🟦|🟧|🟪))?[^=\n]+?==/gu)].map(
    (match) => {
      const value = match[0];
      const from = match.index ?? 0;
      const emoji = value.slice(2).match(/^(?:🟩|🟥|🟦|🟧|🟪)/u)?.[0] ?? "";
      const open = `==${emoji}`;
      return {
        from,
        to: from + value.length,
        contentFrom: from + open.length,
        contentTo: from + value.length - 2,
        open,
        close: "==",
      };
    },
  );

const combinedTildeSpans = (
  text: string,
  spec: InlineFormattingSpec,
): readonly InlineFormattingSpan[] => {
  if (spec.kind !== "underline" && spec.kind !== "strikethrough") return [];
  return [...text.matchAll(/(?<!~)~~~(?=\S)[^~\n]*?\S~~~(?!~)/gu)].map(
    (match) => {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      return spec.kind === "underline"
        ? {
            from,
            to,
            contentFrom: from + 1,
            contentTo: to - 1,
            open: "~",
            close: "~",
          }
        : {
            from: from + 1,
            to: to - 1,
            contentFrom: from + 3,
            contentTo: to - 3,
            open: "~~",
            close: "~~",
          };
    },
  );
};

const formattingSpans = (
  text: string,
  spec: InlineFormattingSpec,
): readonly InlineFormattingSpan[] => {
  if (spec.kind === "highlight") return highlightSpans(text);
  const spans: InlineFormattingSpan[] = [...combinedTildeSpans(text, spec)];
  for (const token of parseDocument(inlineParser, text).tokens) {
    token.children?.forEach((child) =>
      collectTokenSpans(text, child, spec, spans)
    );
  }
  return spans.sort((left, right) => left.from - right.from || right.to - left.to);
};

const fencedParagraphs = (doc: EditorDocument): ReadonlySet<number> => {
  const fenced = new Set<number>();
  for (let paragraph = 0; paragraph < doc.paragraphs.length; paragraph += 1) {
    const opening = flowCliMarkdownFencePrefix(
      doc.paragraphs[paragraph]?.text ?? "",
    );
    if (!opening) continue;
    let closing = paragraph + 1;
    while (
      closing < doc.paragraphs.length &&
      !flowCliMarkdownClosingFenceLine(
        doc.paragraphs[closing]?.text ?? "",
        opening,
      )
    ) {
      closing += 1;
    }
    if (closing >= doc.paragraphs.length) continue;
    for (let index = paragraph; index <= closing; index += 1) {
      fenced.add(index);
    }
    paragraph = closing;
  }
  return fenced;
};

export const inlineFormattingRange = (
  doc: EditorDocument,
  selection: Selection,
): Range => {
  const range = normalizeRange(selection);
  if (!selectionIsCollapsed(selection)) return range;

  const position = range.from;
  const text = doc.paragraphs[position.paragraph]?.text ?? "";
  if (text.length === 0) return range;

  if (
    position.offset < text.length &&
    isWhitespace(text.slice(position.offset, position.offset + 1))
  ) {
    return range;
  }

  let wordFrom = position.offset;
  while (
    wordFrom > 0 &&
    !isWhitespace(text.slice(wordFrom - 1, wordFrom))
  ) {
    wordFrom -= 1;
  }

  let wordTo = position.offset;
  while (
    wordTo < text.length &&
    !isWhitespace(text.slice(wordTo, wordTo + 1))
  ) {
    wordTo += 1;
  }

  return {
    from: { paragraph: position.paragraph, offset: wordFrom },
    to: { paragraph: position.paragraph, offset: wordTo },
  };
};

const paragraphRanges = (
  doc: EditorDocument,
  selection: Selection,
): readonly ParagraphRange[] => {
  const range = inlineFormattingRange(doc, selection);
  const fenced = fencedParagraphs(doc);
  if (selectionIsCollapsed(selection)) {
    return fenced.has(range.from.paragraph)
      ? []
      : [{
          paragraph: range.from.paragraph,
          from: range.from.offset,
          to: range.to.offset,
          caret: selection.head.offset,
        }];
  }

  const lastParagraph =
    range.to.offset === 0 && range.to.paragraph > range.from.paragraph
      ? range.to.paragraph - 1
      : range.to.paragraph;
  const ranges: ParagraphRange[] = [];
  for (
    let paragraph = range.from.paragraph;
    paragraph <= lastParagraph;
    paragraph += 1
  ) {
    if (fenced.has(paragraph)) continue;
    const text = doc.paragraphs[paragraph]?.text ?? "";
    const from = paragraph === range.from.paragraph ? range.from.offset : 0;
    const to = paragraph === range.to.paragraph ? range.to.offset : text.length;
    if (from < to) ranges.push({ paragraph, from, to });
  }
  return ranges;
};

const semanticRange = (
  text: string,
  range: ParagraphRange,
): { readonly from: number; readonly to: number } => {
  let from = range.from;
  let to = range.to;
  while (from < to && formattingMarker.test(text[from])) from += 1;
  while (to > from && formattingMarker.test(text[to - 1])) to -= 1;
  return { from, to };
};

const spanCoversRange = (
  text: string,
  range: ParagraphRange,
  span: InlineFormattingSpan,
  collapsed: boolean,
): boolean => {
  if (collapsed) {
    const caret = range.caret ?? range.from;
    const atDocumentEnd = caret === text.length;
    return span.from <= caret &&
      (caret < span.to || (atDocumentEnd && caret === span.to));
  }
  if (span.from <= range.from && span.to >= range.to) return true;
  const semantic = semanticRange(text, range);
  return semantic.from < semantic.to &&
    span.contentFrom <= semantic.from &&
    span.contentTo >= semantic.to;
};

const rangeIsCovered = (
  text: string,
  range: ParagraphRange,
  spec: InlineFormattingSpec,
  collapsed: boolean,
): boolean =>
  formattingSpans(text, spec).some((span) =>
    spanCoversRange(text, range, span, collapsed)
  );

export const inlineFormattingActive = (
  doc: EditorDocument,
  selection: Selection,
  spec: InlineFormattingSpec,
): boolean => {
  const ranges = paragraphRanges(doc, selection);
  if (ranges.length === 0) return false;
  const collapsed = selectionIsCollapsed(selection);
  return ranges.every((range) =>
    rangeIsCovered(
      doc.paragraphs[range.paragraph]?.text ?? "",
      range,
      spec,
      collapsed,
    )
  );
};

const editsForRange = (
  text: string,
  range: ParagraphRange,
  spec: InlineFormattingSpec,
  toggleOn: boolean,
  canonicalize = false,
): readonly TextEdit[] => {
  const spans = formattingSpans(text, spec);
  const relevant = spans.filter((span) =>
    !toggleOn && range.caret !== undefined
      ? spanCoversRange(text, range, span, true)
      : span.to > range.from && span.from < range.to
  );
  if (!toggleOn) {
    return relevant.flatMap((span) => [
      {
        from: span.from,
        to: span.contentFrom,
        insert: "",
        selectionAfter: false,
      },
      {
        from: span.contentTo,
        to: span.to,
        insert: "",
        selectionAfter: false,
      },
    ]);
  }

  const leading = relevant.find((span) =>
    span.from <= range.from && span.to > range.from
  );
  const trailing = [...relevant].reverse().find((span) =>
    span.from < range.to && span.to >= range.to
  );
  const edits: TextEdit[] = [];
  for (const span of relevant) {
    if (span !== leading) {
      edits.push({
        from: span.from,
        to: span.contentFrom,
        insert: "",
        selectionAfter: false,
      });
    }
    if (span !== trailing) {
      edits.push({
        from: span.contentTo,
        to: span.to,
        insert: "",
        selectionAfter: false,
      });
    }
  }
  if (leading && canonicalize && leading.open !== spec.open) {
    edits.push({
      from: leading.from,
      to: leading.contentFrom,
      insert: spec.open,
      selectionAfter: true,
    });
  }
  if (!leading) {
    edits.push({
      from: range.from,
      to: range.from,
      insert: canonicalize ? spec.open : trailing?.open ?? spec.open,
      selectionAfter: true,
    });
  }
  if (!trailing) {
    edits.push({
      from: range.to,
      to: range.to,
      insert: canonicalize ? spec.close : leading?.close ?? spec.close,
      selectionAfter: false,
    });
  }
  return edits;
};

const transformParagraph = (
  text: string,
  edits: readonly TextEdit[],
): ParagraphTransform => {
  const unique = [...new Map(
    edits.map((edit) => [
      `${edit.from}:${edit.to}:${edit.insert}:${edit.selectionAfter}`,
      edit,
    ]),
  ).values()];
  const descending = [...unique].sort(
    (left, right) =>
      right.from - left.from ||
      right.to - left.to ||
      Number(right.selectionAfter) - Number(left.selectionAfter),
  );
  const nextText = descending.reduce(
    (value, edit) =>
      `${value.slice(0, edit.from)}${edit.insert}${value.slice(edit.to)}`,
    text,
  );
  const ascending = [...unique].sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );
  const mapOffset = (offset: number): number => {
    let delta = 0;
    for (const edit of ascending) {
      if (
        offset < edit.from ||
        (offset === edit.from && !edit.selectionAfter)
      ) {
        break;
      }
      if (edit.from === edit.to) {
        delta += edit.insert.length;
        continue;
      }
      if (offset < edit.to) return edit.from + delta + edit.insert.length;
      delta += edit.insert.length - (edit.to - edit.from);
    }
    return offset + delta;
  };
  return { text: nextText, mapOffset };
};

export const toggleInlineFormatting = (
  context: EditorCommandContext,
  spec: InlineFormattingSpec,
): boolean => {
  if (context.readOnly) return false;
  const ranges = paragraphRanges(context.doc, context.selection);
  if (ranges.length === 0) return false;

  const collapsed = selectionIsCollapsed(context.selection);
  if (collapsed && ranges[0].from === ranges[0].to) {
    const position = context.selection.head;
    const caret = {
      paragraph: position.paragraph,
      offset: position.offset + spec.open.length,
    };
    context.dispatch(
      createTransaction(context.doc, context.selection)
        .replaceRange(position, position, `${spec.open}${spec.close}`)
        .setSelection({ anchor: caret, head: caret })
        .build(),
    );
    return true;
  }

  const toggleOn = !ranges.every((range) =>
    rangeIsCovered(
      context.doc.paragraphs[range.paragraph]?.text ?? "",
      range,
      spec,
      collapsed,
    )
  );
  const transforms = new Map<number, ParagraphTransform>();
  for (const range of ranges) {
    const text = context.doc.paragraphs[range.paragraph]?.text ?? "";
    if (toggleOn && rangeIsCovered(text, range, spec, collapsed)) continue;
    transforms.set(
      range.paragraph,
      transformParagraph(text, editsForRange(text, range, spec, toggleOn)),
    );
  }
  if (transforms.size === 0) return true;

  const transaction = createTransaction(context.doc, context.selection);
  for (const [paragraph, transform] of [...transforms].sort(
    ([left], [right]) => right - left,
  )) {
    transaction.replaceRange(
      { paragraph, offset: 0 },
      {
        paragraph,
        offset: context.doc.paragraphs[paragraph]?.text.length ?? 0,
      },
      transform.text,
    );
  }
  const mapPosition = (position: Position): Position => ({
    paragraph: position.paragraph,
    offset: transforms.get(position.paragraph)?.mapOffset(position.offset) ??
      position.offset,
  });
  transaction.setSelection({
    anchor: mapPosition(context.selection.anchor),
    head: mapPosition(context.selection.head),
  });
  context.dispatch(transaction.build());
  return true;
};

const forceInlineFormatting = (
  context: EditorCommandContext,
  spec: InlineFormattingSpec,
  toggleOn: boolean,
): boolean => {
  if (context.readOnly) return false;
  const ranges = paragraphRanges(context.doc, context.selection);
  if (ranges.length === 0) return false;

  const collapsed = selectionIsCollapsed(context.selection);
  if (toggleOn && collapsed && ranges[0].from === ranges[0].to) {
    const position = context.selection.head;
    const caret = {
      paragraph: position.paragraph,
      offset: position.offset + spec.open.length,
    };
    context.dispatch(
      createTransaction(context.doc, context.selection)
        .replaceRange(position, position, `${spec.open}${spec.close}`)
        .setSelection({ anchor: caret, head: caret })
        .build(),
    );
    return true;
  }

  const transforms = new Map<number, ParagraphTransform>();
  for (const range of ranges) {
    const text = context.doc.paragraphs[range.paragraph]?.text ?? "";
    const edits = editsForRange(text, range, spec, toggleOn, toggleOn);
    if (!toggleOn && edits.length === 0) continue;
    transforms.set(
      range.paragraph,
      transformParagraph(text, edits),
    );
  }
  if (transforms.size === 0) return false;

  const transaction = createTransaction(context.doc, context.selection);
  for (const [paragraph, transform] of [...transforms].sort(
    ([left], [right]) => right - left,
  )) {
    transaction.replaceRange(
      { paragraph, offset: 0 },
      {
        paragraph,
        offset: context.doc.paragraphs[paragraph]?.text.length ?? 0,
      },
      transform.text,
    );
  }
  const mapPosition = (position: Position): Position => ({
    paragraph: position.paragraph,
    offset: transforms.get(position.paragraph)?.mapOffset(position.offset) ??
      position.offset,
  });
  transaction.setSelection({
    anchor: mapPosition(context.selection.anchor),
    head: mapPosition(context.selection.head),
  });
  context.dispatch(transaction.build());
  return true;
};

export const applyInlineFormatting = (
  context: EditorCommandContext,
  spec: InlineFormattingSpec,
): boolean => forceInlineFormatting(context, spec, true);

export const removeInlineFormatting = (
  context: EditorCommandContext,
  spec: InlineFormattingSpec,
): boolean => forceInlineFormatting(context, spec, false);

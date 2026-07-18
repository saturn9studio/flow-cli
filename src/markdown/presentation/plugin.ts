import {
  PluginId,
  absoluteOffset,
  normalizeRange,
  type EditorDecoration,
  type EditorPlugin,
  type Selection,
  type TextStyle,
} from "../../engine/index.js";
import {
  requireMarkdownSyntaxSnapshot,
  type MarkdownSyntaxSnapshot,
} from "./syntax.js";
import {
  createMarkdownImageWidgets,
  type MarkdownImageWidgetOptions,
} from "./images.js";
import { sentenceRangeAt, withInactiveFocusStyle } from "../focus.js";
import { highlightCode } from "../code-highlight.js";
import { linkAtRange } from "./spans.js";
import { findMarkdownImages } from "./spans.js";
import {
  findFlowCliMarkdownInlineMath,
  findFlowCliMarkdownMathBlocks,
} from "./parser.js";

export type MarkdownPresentationMode = "edit" | "source" | "focus" | "read";

export interface LinkActivationEffect {
  readonly type: "activateLink";
  readonly url: string;
  readonly text: string;
  readonly title?: string;
}

export interface MarkdownPluginOptions {
  readonly mode?: MarkdownPresentationMode;
  readonly imageWidgets?: MarkdownImageWidgetOptions | false;
  readonly onLinkActivate?: (effect: LinkActivationEffect) => void;
}

interface MarkdownPluginState {
  readonly sourceRevision: number;
}

export const markdownPluginId =
  new PluginId<MarkdownPluginState>("scribecli.markdown");

interface OffsetRange {
  readonly from: number;
  readonly to: number;
}

const selectionRange = (
  syntax: MarkdownSyntaxSnapshot,
  selection: Selection,
): OffsetRange => {
  const range = normalizeRange(selection);
  const lineStarts = [0];
  for (let index = 0; index < syntax.source.length; index += 1) {
    if (syntax.source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  const offset = (position: Selection["head"]): number =>
    (lineStarts[position.paragraph] ?? syntax.source.length) + position.offset;
  return { from: offset(range.from), to: offset(range.to) };
};

const selectionTouches = (
  selection: OffsetRange,
  from: number,
  to: number,
): boolean => selection.from <= to && selection.to >= from;

const overlaps = (a: OffsetRange, b: OffsetRange): boolean =>
  a.from < b.to && a.to > b.from;

const markdownMarkupStyle = { role: "markdownMarkup", dim: true } as const;
const markdownCodeMarkupStyle = { role: "markdownCodeMarkup", dim: true } as const;

class DecorationBuilder {
  readonly decorations: EditorDecoration[] = [];
  private readonly presentationRanges: OffsetRange[] = [];

  constructor(
    private readonly mode: MarkdownPresentationMode,
    private readonly selection: OffsetRange,
  ) {}

  inline(from: number, to: number, style: TextStyle): void {
    if (from >= to) return;
    this.decorations.push({ kind: "inline", from, to, style });
  }

  line(from: number, to: number, backgroundRole: string): void {
    if (from >= to) return;
    this.decorations.push({ kind: "line", from, to, backgroundRole });
  }

  markup(
    from: number,
    to: number,
    construct: OffsetRange,
    replacement?: { readonly text: string; readonly style?: TextStyle },
    style: TextStyle = markdownMarkupStyle,
  ): void {
    if (from >= to) return;
    this.inline(from, to, style);
    if (
      this.mode === "source" ||
      (
        this.mode !== "read" &&
        selectionTouches(this.selection, construct.from, construct.to)
      )
    ) {
      return;
    }

    const range = { from, to };
    if (this.presentationRanges.some((candidate) => overlaps(candidate, range))) return;
    this.presentationRanges.push(range);
    this.decorations.push(
      replacement
        ? {
            kind: "replace",
            from,
            to,
            text: replacement.text,
            style: replacement.style,
          }
        : { kind: "conceal", from, to },
    );
  }
}

interface PairedMarkup {
  readonly pattern: RegExp;
  readonly markerLength: number;
  readonly style: TextStyle;
}

const pairedMarkup: readonly PairedMarkup[] = [
  {
    pattern: /==(?:(?:🟩|🟥|🟦|🟧|🟪))?(?=\S)(?<body>[^\n]*?\S)==/gu,
    markerLength: 2,
    style: { role: "markdownHighlight", inverse: true },
  },
  {
    pattern: /\*\*(?=\S)(?<body>[^\n]*?\S)\*\*/gu,
    markerLength: 2,
    style: { role: "markdownStrong", bold: true },
  },
  {
    pattern: /__(?=\S)(?<body>[^\n]*?\S)__/gu,
    markerLength: 2,
    style: { role: "markdownStrong", bold: true },
  },
  {
    pattern: /~~(?=\S)(?<body>[^\n]*?\S)~~/gu,
    markerLength: 2,
    style: { role: "markdownDeleted", strikethrough: true },
  },
  {
    pattern: /(?<!\*)\*(?!\*)(?=\S)(?<body>[^\n]*?\S)\*(?!\*)/gu,
    markerLength: 1,
    style: { role: "markdownEmphasis", italic: true },
  },
  {
    pattern: /(?<!_)_(?!_)(?=\S)(?<body>[^\n]*?\S)_(?!_)/gu,
    markerLength: 1,
    style: { role: "markdownEmphasis", italic: true },
  },
  {
    pattern: /(?<!~)~(?!~)(?=\S)(?<body>[^\n]*?\S)~(?!~)/gu,
    markerLength: 1,
    style: { role: "markdownUnderline", underline: true },
  },
];

const tokenRanges = (
  syntax: MarkdownSyntaxSnapshot,
  kind: string,
): readonly OffsetRange[] =>
  syntax.tokenViews
    .filter((view) => view.kind === kind)
    .map((view) => ({ from: view.from, to: view.to }));

const rangeContains = (
  ranges: readonly OffsetRange[],
  offset: number,
): boolean => ranges.some((range) => range.from <= offset && offset < range.to);

const decorateHighlightedSource = (
  builder: DecorationBuilder,
  from: number,
  source: string,
  language: string,
): void => {
  let offset = from;
  const lines = source.split("\n");
  const highlighted = highlightCode(source, language);
  highlighted.forEach((line, lineIndex) => {
    for (const run of line) {
      if (run.text.length > 0 && run.style && run.style.role !== "markdownCode") {
        builder.inline(offset, offset + run.text.length, run.style);
      }
      offset += run.text.length;
    }
    if (lineIndex < lines.length - 1) offset += 1;
  });
};

const decorateFences = (
  syntax: MarkdownSyntaxSnapshot,
  builder: DecorationBuilder,
): readonly OffsetRange[] => {
  const ranges = tokenRanges(syntax, "fence");
  for (const range of ranges) {
    builder.line(range.from, range.to, "markdownCode");
    builder.inline(range.from, range.to, { role: "markdownCode" });
    const source = syntax.source.slice(range.from, range.to);
    const lines = source.split("\n");
    const opening = lines[0]?.match(/^( {0,3})(`{3,}|~{3,})/u);
    const firstLineEnd = source.indexOf("\n");
    const finalLineStart = source.lastIndexOf("\n") + 1;
    if (opening) {
      const markerFrom = range.from + opening[1].length;
      builder.markup(
        markerFrom,
        markerFrom + opening[2].length,
        range,
        undefined,
        markdownCodeMarkupStyle,
      );
      if (firstLineEnd >= 0 && finalLineStart > firstLineEnd) {
        const bodyFrom = range.from + firstLineEnd + 1;
        const bodyTo = range.from + Math.max(firstLineEnd + 1, finalLineStart - 1);
        const language = (lines[0] ?? "")
          .slice(opening[1].length + opening[2].length)
          .trim()
          .split(/\s+/u)[0] ?? "";
        decorateHighlightedSource(
          builder,
          bodyFrom,
          syntax.source.slice(bodyFrom, bodyTo),
          language,
        );
      }
    }

    const closing = source.slice(finalLineStart).match(/^( {0,3})(`{3,}|~{3,})/u);
    if (closing && finalLineStart > 0) {
      const markerFrom = range.from + finalLineStart + closing[1].length;
      builder.markup(
        markerFrom,
        markerFrom + closing[2].length,
        range,
        undefined,
        markdownCodeMarkupStyle,
      );
    }
  }
  return ranges;
};

const decorateMathBlocks = (
  syntax: MarkdownSyntaxSnapshot,
  builder: DecorationBuilder,
  protectedRanges: readonly OffsetRange[],
): readonly OffsetRange[] => {
  const mathBlocks = tokenRanges(syntax, "math_block");
  const ranges: OffsetRange[] = [];
  for (const block of findFlowCliMarkdownMathBlocks(syntax.source)) {
    const range = { from: block.from, to: block.to };
    if (
      !rangeContains(mathBlocks, block.from) ||
      protectedRanges.some((candidate) => overlaps(candidate, range))
    ) {
      continue;
    }
    ranges.push(range);
    builder.line(block.from, block.to, "markdownCode");
    builder.inline(block.from, block.to, { role: "markdownCode" });
    const bodyTo = block.bodyTo > block.bodyFrom &&
        syntax.source.charCodeAt(block.bodyTo - 1) === 10
      ? block.bodyTo - 1
      : block.bodyTo;
    decorateHighlightedSource(
      builder,
      block.bodyFrom,
      syntax.source.slice(block.bodyFrom, bodyTo),
      "latex",
    );
    builder.markup(
      block.openingMarkerFrom,
      block.openingMarkerTo,
      range,
      undefined,
      markdownCodeMarkupStyle,
    );
    builder.markup(
      block.closingMarkerFrom,
      block.closingMarkerTo,
      range,
      undefined,
      markdownCodeMarkupStyle,
    );
  }
  return ranges;
};

const decorateHeadings = (
  syntax: MarkdownSyntaxSnapshot,
  builder: DecorationBuilder,
): void => {
  const headings = tokenRanges(syntax, "heading");
  for (const match of syntax.source.matchAll(/^( {0,3})(#{1,6})([ \t]+)(.*)$/gmu)) {
    const from = match.index ?? 0;
    if (!rangeContains(headings, from)) continue;
    const markerFrom = from + match[1].length;
    const bodyFrom = markerFrom + match[2].length + match[3].length;
    const to = from + match[0].length;
    builder.markup(markerFrom, bodyFrom, { from, to });
    builder.inline(bodyFrom, to, {
      role: `markdownHeading${match[2].length}`,
      bold: true,
    });
  }
};

const decorateLists = (
  source: string,
  builder: DecorationBuilder,
  protectedRanges: readonly OffsetRange[],
): void => {
  const markers = ["•", "◦", "▪", "▫"] as const;
  const indentStack: number[] = [];
  for (const match of source.matchAll(/^([ \t]*)(\d+[.)]|[-+*])([ \t]+)/gmu)) {
    const from = match.index ?? 0;
    if (rangeContains(protectedRanges, from)) continue;
    const indent = match[1];
    const rawMarker = match[2];
    const indentColumns = [...indent].reduce(
      (total, char) => total + (char === "\t" ? 4 : 1),
      0,
    );
    while (
      indentStack.length > 0 &&
      indentColumns < (indentStack[indentStack.length - 1] ?? 0)
    ) {
      indentStack.pop();
    }
    if (
      indentStack.length === 0 ||
      indentColumns > (indentStack[indentStack.length - 1] ?? -1)
    ) {
      indentStack.push(indentColumns);
    }
    const level = Math.max(1, indentStack.length);
    const markerFrom = from + indent.length;
    const markerTo = markerFrom + rawMarker.length;
    const lineEnd = source.indexOf("\n", from);
    const construct = {
      from,
      to: lineEnd === -1 ? source.length : lineEnd,
    };
    const replacement = /^[-+*]$/u.test(rawMarker)
      ? markers[(level - 1) % markers.length]
      : rawMarker;
    builder.markup(markerFrom, markerTo, construct, {
      text: replacement,
      style: { role: "markdownListMarker", bold: true },
    });
  }
};

const decorateBlockquotes = (
  source: string,
  builder: DecorationBuilder,
  protectedRanges: readonly OffsetRange[],
): void => {
  for (const match of source.matchAll(/^( {0,3})((?:>[ \t]?)+)/gmu)) {
    const from = match.index ?? 0;
    if (rangeContains(protectedRanges, from)) continue;
    const lineEnd = source.indexOf("\n", from);
    const construct = { from, to: lineEnd === -1 ? source.length : lineEnd };
    const prefixFrom = from + (match[1]?.length ?? 0);
    const prefix = match[2] ?? "";
    builder.line(from, construct.to, "markdownQuote");
    for (
      const whitespace of source.slice(from, prefixFrom + prefix.length)
        .matchAll(/[ \t]+/gu)
    ) {
      const whitespaceFrom = from + (whitespace.index ?? 0);
      builder.inline(whitespaceFrom, whitespaceFrom + whitespace[0].length, {
        role: "markdownQuote",
      });
    }
    for (const marker of prefix.matchAll(/>/gu)) {
      const markerFrom = prefixFrom + (marker.index ?? 0);
      builder.markup(markerFrom, markerFrom + 1, construct, {
        text: "│",
        style: { role: "markdownQuoteMarker", bold: true },
      });
    }
    builder.inline(prefixFrom + prefix.length, construct.to, {
      role: "markdownQuote",
    });
  }
};

const decorateSeparators = (
  syntax: MarkdownSyntaxSnapshot,
  builder: DecorationBuilder,
): void => {
  const separators = tokenRanges(syntax, "hr");
  for (const range of separators) {
    builder.markup(range.from, range.to, range, {
      text: "────────",
      style: { role: "markdownSeparator", dim: true },
    });
  }
};

const decorateInlineCode = (
  source: string,
  builder: DecorationBuilder,
  protectedRanges: readonly OffsetRange[],
): readonly OffsetRange[] => {
  const ranges: OffsetRange[] = [];
  for (const match of source.matchAll(/(?<!`)`(?!`)(?<body>[^`\n]+)`(?!`)/gu)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (protectedRanges.some((range) => overlaps(range, { from, to }))) continue;
    const range = { from, to };
    ranges.push(range);
    builder.markup(from, from + 1, range);
    builder.markup(to - 1, to, range);
    builder.inline(from + 1, to - 1, { role: "markdownCode" });
  }
  return ranges;
};

const decorateInlineMath = (
  source: string,
  builder: DecorationBuilder,
  protectedRanges: readonly OffsetRange[],
): readonly OffsetRange[] => {
  const ranges: OffsetRange[] = [];
  for (const math of findFlowCliMarkdownInlineMath(source)) {
    const range = { from: math.from, to: math.to };
    if (protectedRanges.some((candidate) => overlaps(candidate, range))) continue;
    ranges.push(range);
    builder.markup(math.from, math.bodyFrom, range);
    builder.inline(math.bodyFrom, math.bodyTo, { role: "markdownCode" });
    builder.markup(math.bodyTo, math.to, range);
  }
  return ranges;
};

const decorateImages = (
  source: string,
  builder: DecorationBuilder,
  protectedRanges: readonly OffsetRange[],
): readonly OffsetRange[] => {
  const ranges: OffsetRange[] = [];
  for (const image of findMarkdownImages(source)) {
    const { from, to } = image;
    if (protectedRanges.some((range) => overlaps(range, { from, to }))) continue;
    const range = { from, to };
    ranges.push(range);
    const replacement = `▣ ${image.alt || image.src || "image"}`;
    builder.markup(from, to, range, {
      text: replacement,
      style: { role: "markdownImage", bold: true },
    });
  }
  return ranges;
};

const decorateLinks = (
  source: string,
  builder: DecorationBuilder,
  protectedRanges: readonly OffsetRange[],
): readonly OffsetRange[] => {
  const ranges: OffsetRange[] = [];
  const pattern = /(?<!!)\[(?<label>[^\]\n]+)\]\((?<url>[^)\s]+)(?:[ \t]+["'](?<title>.*?)["'])?\)/gu;
  for (const match of source.matchAll(pattern)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (protectedRanges.some((range) => overlaps(range, { from, to }))) continue;
    const label = match.groups?.label ?? "";
    const labelFrom = from + 1;
    const labelTo = labelFrom + label.length;
    const range = { from, to };
    ranges.push(range);
    builder.markup(from, labelFrom, range);
    builder.inline(labelFrom, labelTo, {
      role: "markdownLink",
      underline: true,
    });
    builder.markup(labelTo, to, range);
  }
  return ranges;
};

const decoratePairs = (
  source: string,
  builder: DecorationBuilder,
  protectedRanges: readonly OffsetRange[],
): void => {
  for (const syntax of pairedMarkup) {
    for (const match of source.matchAll(syntax.pattern)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      const range = { from, to };
      if (protectedRanges.some((candidate) => overlaps(candidate, range))) continue;
      let openingTo = from + syntax.markerLength;
      if (syntax.style.role === "markdownHighlight") {
        const emoji = source.slice(openingTo).match(/^(?:🟩|🟥|🟦|🟧|🟪)/u)?.[0];
        if (emoji) openingTo += emoji.length;
      }
      const closingFrom = to - syntax.markerLength;
      builder.markup(from, openingTo, range);
      builder.inline(openingTo, closingFrom, syntax.style);
      builder.markup(closingFrom, to, range);
    }
  }
};

export const createMarkdownDecorations = (
  syntax: MarkdownSyntaxSnapshot,
  selection: Selection,
  mode: MarkdownPresentationMode = "edit",
): readonly EditorDecoration[] => {
  const builder = new DecorationBuilder(mode, selectionRange(syntax, selection));
  if (syntax.source.length > 0) {
    builder.inline(0, syntax.source.length, { role: "markdownText" });
  }

  const fences = decorateFences(syntax, builder);
  const mathBlocks = decorateMathBlocks(syntax, builder, fences);
  const blockRanges = [...fences, ...mathBlocks];
  decorateHeadings(syntax, builder);
  decorateSeparators(syntax, builder);
  decorateLists(syntax.source, builder, blockRanges);
  decorateBlockquotes(syntax.source, builder, blockRanges);
  const inlineCode = decorateInlineCode(syntax.source, builder, blockRanges);
  const inlineMath = decorateInlineMath(
    syntax.source,
    builder,
    [...blockRanges, ...inlineCode],
  );
  const images = decorateImages(
    syntax.source,
    builder,
    [...blockRanges, ...inlineCode, ...inlineMath],
  );
  const links = decorateLinks(
    syntax.source,
    builder,
    [...blockRanges, ...inlineCode, ...inlineMath, ...images],
  );
  decoratePairs(
    syntax.source,
    builder,
    [...blockRanges, ...inlineCode, ...inlineMath, ...images, ...links],
  );
  if (mode === "focus" && syntax.source.length > 0) {
    const selected = selectionRange(syntax, selection);
    const activeSentence = selected.from === selected.to
      ? sentenceRangeAt(syntax.source, selected.from)
      : null;
    if (!activeSentence || activeSentence.from > 0) {
      builder.inline(0, activeSentence?.from ?? syntax.source.length, {
        role: "focusInactive",
        dim: true,
      });
    }
    if (activeSentence && activeSentence.to < syntax.source.length) {
      builder.inline(activeSentence.to, syntax.source.length, {
        role: "focusInactive",
        dim: true,
      });
    }
  }
  return builder.decorations;
};

export const markdownPlugin = (
  options: MarkdownPluginOptions = {},
): EditorPlugin<MarkdownPluginState> => ({
  id: markdownPluginId,
  init: () => ({ sourceRevision: 0 }),
  apply: ({ state, transaction }) =>
    transaction.displayChanges.length > 0
      ? { sourceRevision: state.sourceRevision + 1 }
      : state,
  decorations: ({ syntax, selection, doc }) => {
    const snapshot = requireMarkdownSyntaxSnapshot(syntax);
    // Assert the shared UTF-16 coordinate convention at the plugin boundary.
    const end = normalizeRange(selection).to;
    absoluteOffset(doc, end);
    return createMarkdownDecorations(snapshot, selection, options.mode);
  },
  widgets: options.imageWidgets && options.mode !== "source"
    ? ({ doc, selection, content, syntax }) => {
        const widgets = createMarkdownImageWidgets(
          doc,
          selection,
          content,
          {
            ...(options.imageWidgets as MarkdownImageWidgetOptions),
            revealSourceOnSelection: options.mode !== "read",
          },
          requireMarkdownSyntaxSnapshot(syntax).tokenViews
            .filter((view) => view.kind === "fence")
            .map((view) => ({ from: view.from, to: view.to })),
        );
        return options.mode === "focus"
          ? widgets.map((widget) => ({
              ...widget,
              render: withInactiveFocusStyle(widget.render, {
                grayscaleColors: true,
                muteGraphic: true,
              }),
            }))
          : widgets;
      }
    : undefined,
  handleInput: options.onLinkActivate
    ? ({ event, content, doc, selection }) => {
        if (
          event.kind !== "key" ||
          event.key !== "Enter" ||
          (!event.ctrl && !event.meta)
        ) {
          return false;
        }
        const range = normalizeRange(selection);
        const link = linkAtRange(content, {
          from: absoluteOffset(doc, range.from),
          to: absoluteOffset(doc, range.to),
        });
        if (!link) return false;
        options.onLinkActivate?.({
          type: "activateLink",
          url: link.url,
          text: link.text,
          title: link.title,
        });
        return true;
      }
    : undefined,
});

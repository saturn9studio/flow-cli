import {
  absoluteOffset,
  normalizeRange,
  textInRange,
  type EditorCommandContext,
  type EditorSnapshot,
  type TerminalEditor,
} from "../engine/index.js";
import {
  applyInlineFormatting,
  inlineFormattingSpecs,
  removeInlineFormatting,
} from "./commands/inline.js";

export type HighlightColor =
  | "yellow"
  | "green"
  | "pink"
  | "blue"
  | "orange"
  | "purple";

export interface MarkdownHighlightSpan {
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
  readonly text: string;
  readonly color: HighlightColor;
  readonly emoji: string;
}

export interface HighlightColorResult {
  readonly isHighlight: boolean;
  readonly color: HighlightColor | "";
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

export interface HighlightColorCommandArgs {
  readonly action: "check" | "apply" | "remove";
  readonly color?: HighlightColor;
}

export const highlightColorSpecs = [
  { color: "yellow", emoji: "" },
  { color: "green", emoji: "🟩" },
  { color: "pink", emoji: "🟥" },
  { color: "blue", emoji: "🟦" },
  { color: "orange", emoji: "🟧" },
  { color: "purple", emoji: "🟪" },
] as const;

const emojiPattern = highlightColorSpecs
  .filter((spec) => spec.emoji.length > 0)
  .map((spec) => spec.emoji)
  .join("");
const highlightPattern = new RegExp(`==([${emojiPattern}])?([^=\\n]+?)==`, "gu");

const colorForEmoji = (emoji: string): HighlightColor =>
  highlightColorSpecs.find((spec) => spec.emoji === emoji)?.color ?? "yellow";

const emojiForColor = (color: HighlightColor): string =>
  highlightColorSpecs.find((spec) => spec.color === color)?.emoji ?? "";

export const findMarkdownHighlights = (
  markdown: string,
): readonly MarkdownHighlightSpan[] =>
  [...markdown.matchAll(highlightPattern)].map((match) => {
    const from = match.index ?? 0;
    const emoji = match[1] ?? "";
    const text = match[2] ?? "";
    const contentFrom = from + 2 + emoji.length;
    return {
      from,
      to: from + match[0].length,
      contentFrom,
      contentTo: contentFrom + text.length,
      text,
      color: colorForEmoji(emoji),
      emoji,
    };
  });

export const highlightAtRange = (
  markdown: string,
  range: { readonly from: number; readonly to: number },
): MarkdownHighlightSpan | null =>
  findMarkdownHighlights(markdown).find((highlight) =>
    range.from === range.to
      ? highlight.from <= range.from && highlight.to >= range.from
      : (highlight.from <= range.from && highlight.to >= range.to) ||
        (range.from <= highlight.from && range.to >= highlight.to),
  ) ?? null;

const selectionOffsets = (context: EditorSnapshot) => {
  const range = normalizeRange(context.selection);
  return {
    from: absoluteOffset(context.doc, range.from),
    to: absoluteOffset(context.doc, range.to),
  };
};

export const checkHighlightColor = (
  context: EditorSnapshot,
): HighlightColorResult => {
  const selected = selectionOffsets(context);
  const highlight = highlightAtRange(context.content, selected);
  return highlight
    ? {
        isHighlight: true,
        color: highlight.color,
        text: highlight.text,
        from: highlight.from,
        to: highlight.to,
      }
    : {
        isHighlight: false,
        color: "",
        text: textInRange(context.doc, normalizeRange(context.selection)),
        ...selected,
      };
};

export const applyHighlightColor = (
  context: EditorCommandContext,
  color: HighlightColor,
): boolean => {
  const opening = `==${emojiForColor(color)}`;
  return applyInlineFormatting(context, {
    ...inlineFormattingSpecs.highlight,
    open: opening,
  });
};

export const removeHighlightColor = (
  context: EditorCommandContext,
): boolean => {
  return removeInlineFormatting(context, inlineFormattingSpecs.highlight);
};

export const executeHighlightColorAction = (
  editor: TerminalEditor,
  args: HighlightColorCommandArgs,
): HighlightColorResult | boolean => {
  const context: EditorCommandContext = {
    ...editor.snapshot(),
    dispatch: (transaction) => editor.dispatch(transaction),
    execute: (commandName) => editor.execute(commandName),
  };
  switch (args.action) {
    case "check":
      return checkHighlightColor(context);
    case "apply":
      return applyHighlightColor(context, args.color ?? "yellow");
    case "remove":
      return removeHighlightColor(context);
  }
};

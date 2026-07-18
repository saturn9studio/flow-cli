import {
  createTransaction,
  editorCommandNames,
  normalizeRange,
  selectionIsCollapsed,
  textInRange,
  type EditorCommandContext,
  type EditorKeyBinding,
} from "../../engine/index.js";
import {
  applyHighlightColor,
  checkHighlightColor,
  highlightColorSpecs,
  type HighlightColor,
} from "../highlight.js";
import type { Command, CommandStatusContext } from "./command.js";
import { insertTable } from "./formatting.js";
import {
  inlineFormattingActive,
  inlineFormattingSpecs,
  toggleInlineFormatting,
  type InlineFormattingSpec,
} from "./inline.js";
import type { CommandRegistry } from "./registry.js";

export const flowCommandNames = Object.freeze({
  undo: "flow.undo",
  redo: "flow.redo",
  selectAll: "flow.selectAll",
  bold: "flow.bold",
  italic: "flow.italic",
  underline: "flow.underline",
  strikethrough: "flow.strikethrough",
  code: "flow.code",
  math: "flow.math",
  highlight: "flow.highlight",
  highlightYellow: "flow.highlightYellow",
  highlightGreen: "flow.highlightGreen",
  highlightPink: "flow.highlightPink",
  highlightBlue: "flow.highlightBlue",
  highlightOrange: "flow.highlightOrange",
  highlightPurple: "flow.highlightPurple",
  heading1: "flow.heading1",
  heading2: "flow.heading2",
  heading3: "flow.heading3",
  heading4: "flow.heading4",
  heading5: "flow.heading5",
  heading6: "flow.heading6",
  bulletList: "flow.bulletList",
  orderedList: "flow.orderedList",
  blockquote: "flow.blockquote",
  codeBlock: "flow.codeBlock",
  mathBlock: "flow.mathBlock",
  horizontalRule: "flow.horizontalRule",
  fancyHorizontalRule: "flow.fancyHorizontalRule",
  table: "flow.table",
});

export const defaultFlowKeymap: readonly EditorKeyBinding[] = [
  { key: "Mod+Z", command: flowCommandNames.undo },
  { key: "Mod+Shift+Z", command: flowCommandNames.redo },
  { key: "Mod+Y", command: flowCommandNames.redo },
  { key: "Mod+A", command: flowCommandNames.selectAll },
  { key: "Mod+B", command: flowCommandNames.bold },
  { key: "Mod+I", command: flowCommandNames.italic },
  { key: "Mod+U", command: flowCommandNames.underline },
  { key: "Mod+Shift+U", command: flowCommandNames.strikethrough },
  { key: "Mod+Shift+H", command: flowCommandNames.highlight },
  { key: "Mod+Alt+1", command: flowCommandNames.heading1 },
  { key: "Mod+Alt+2", command: flowCommandNames.heading2 },
  { key: "Mod+Alt+3", command: flowCommandNames.heading3 },
  { key: "Mod+Shift+7", command: flowCommandNames.orderedList },
  { key: "Mod+Shift+8", command: flowCommandNames.bulletList },
];

const isEditable = (context: CommandStatusContext): boolean => !context.readOnly;
const selectionText = (
  context: EditorCommandContext | CommandStatusContext,
): string => textInRange(context.doc, normalizeRange(context.selection));
const activeWrappedSelection =
  (spec: InlineFormattingSpec) =>
  (context: CommandStatusContext): boolean =>
    inlineFormattingActive(context.doc, context.selection, spec);

const toggleWrappedSelection =
  (spec: InlineFormattingSpec) =>
  (context: EditorCommandContext): boolean =>
    toggleInlineFormatting(context, spec);

const selectedParagraphIndexes = (
  context: EditorCommandContext | CommandStatusContext,
): readonly number[] => {
  const range = normalizeRange(context.selection);
  const to =
    range.to.offset === 0 && range.to.paragraph > range.from.paragraph
      ? range.to.paragraph - 1
      : range.to.paragraph;
  return Array.from(
    { length: Math.max(0, to - range.from.paragraph + 1) },
    (_value, index) => range.from.paragraph + index,
  );
};

const replaceSelectedParagraphs = (
  context: EditorCommandContext,
  transform: (text: string, index: number) => string,
): boolean => {
  if (context.readOnly) return false;
  const paragraphs = selectedParagraphIndexes(context);
  if (paragraphs.length === 0) return false;
  const last = paragraphs.at(-1)!;
  const replacement = paragraphs
    .map((paragraph, index) =>
      transform(context.doc.paragraphs[paragraph]?.text ?? "", index),
    )
    .join("\n");
  const transaction = createTransaction(context.doc, context.selection)
      .replaceRange(
        { paragraph: paragraphs[0], offset: 0 },
        {
          paragraph: last,
          offset: context.doc.paragraphs[last]?.text.length ?? 0,
        },
        replacement,
      );
  context.dispatch(
    transaction
      .setSelection({
        anchor: { paragraph: paragraphs[0], offset: 0 },
        head: {
          paragraph: last,
          offset: transaction.doc.paragraphs[last]?.text.length ?? 0,
        },
      })
      .build(),
  );
  return true;
};

const headingPattern = /^(#{1,6})(?:[ \t]+|$)/u;
const headingActive =
  (level: number) =>
  (context: CommandStatusContext): boolean =>
    selectedParagraphIndexes(context).every((paragraph) =>
      new RegExp(`^#{${level}}(?:[ \\t]+|$)`, "u").test(
        context.doc.paragraphs[paragraph]?.text ?? "",
      ),
    );
const setHeading =
  (level: number) =>
  (context: EditorCommandContext): boolean => {
    const active = headingActive(level)(context);
    return replaceSelectedParagraphs(context, (text) => {
      const content = text.replace(headingPattern, "");
      return active ? content : `${"#".repeat(level)} ${content}`;
    });
  };

const prefixActive =
  (pattern: RegExp) =>
  (context: CommandStatusContext): boolean =>
    selectedParagraphIndexes(context).every((paragraph) =>
      pattern.test(context.doc.paragraphs[paragraph]?.text ?? ""),
    );
const togglePrefix =
  (pattern: RegExp, prefix: (index: number) => string) =>
  (context: EditorCommandContext): boolean => {
    const active = prefixActive(pattern)(context);
    return replaceSelectedParagraphs(context, (text, index) =>
      active ? text.replace(pattern, "") : `${prefix(index)}${text}`,
    );
  };

const toggleCodeBlock = (context: EditorCommandContext): boolean => {
  if (context.readOnly) return false;
  const range = normalizeRange(context.selection);
  const transaction = createTransaction(context.doc, context.selection);
  if (selectionIsCollapsed(context.selection)) {
    const caret = { paragraph: range.from.paragraph + 1, offset: 0 };
    context.dispatch(
      transaction
        .replaceRange(range.from, range.to, "```\n\n```")
        .setSelection({ anchor: caret, head: caret })
        .build(),
    );
    return true;
  }
  const text = selectionText(context);
  const unwrapped = text.match(/^```[^\n]*\n([\s\S]*)\n```$/u)?.[1];
  context.dispatch(
    transaction
      .replaceRange(range.from, range.to, unwrapped ?? `\`\`\`\n${text}\n\`\`\``)
      .build(),
  );
  return true;
};

const toggleMathBlock = (context: EditorCommandContext): boolean => {
  if (context.readOnly) return false;
  const range = normalizeRange(context.selection);
  const transaction = createTransaction(context.doc, context.selection);
  if (selectionIsCollapsed(context.selection)) {
    const caret = { paragraph: range.from.paragraph + 1, offset: 0 };
    context.dispatch(
      transaction
        .replaceRange(range.from, range.to, "$$\n\n$$")
        .setSelection({ anchor: caret, head: caret })
        .build(),
    );
    return true;
  }
  const text = selectionText(context);
  const unwrapped = text.match(/^\$\$\n([\s\S]*)\n\$\$$/u)?.[1];
  context.dispatch(
    transaction
      .replaceRange(range.from, range.to, unwrapped ?? `$$\n${text}\n$$`)
      .build(),
  );
  return true;
};

const insertHorizontalRule =
  (markup: "---" | "***") =>
  (context: EditorCommandContext): boolean => {
    if (context.readOnly) return false;
    const range = normalizeRange(context.selection);
    const before = range.from.offset === 0 ? "" : "\n";
    const after =
      range.to.offset ===
      (context.doc.paragraphs[range.to.paragraph]?.text.length ?? 0)
        ? ""
        : "\n";
    context.dispatch(
      createTransaction(context.doc, context.selection)
        .replaceRange(range.from, range.to, `${before}${markup}${after}`)
        .build(),
    );
    return true;
  };

const highlightCommandNames: Record<HighlightColor, string> = {
  yellow: flowCommandNames.highlightYellow,
  green: flowCommandNames.highlightGreen,
  pink: flowCommandNames.highlightPink,
  blue: flowCommandNames.highlightBlue,
  orange: flowCommandNames.highlightOrange,
  purple: flowCommandNames.highlightPurple,
};

const blockCommand = (
  id: string,
  label: string,
  active: Command["active"],
  run: Command["run"],
  accelerator?: string,
): Command => ({
  id,
  label,
  accelerator,
  group: "blocks",
  enabled: isEditable,
  active,
  run,
});

export const createDefaultCommands = (): readonly Command[] => [
  {
    id: flowCommandNames.undo,
    label: "Undo",
    accelerator: "Mod+Z",
    group: "history",
    enabled: (context) => context.canUndo ?? true,
    run: (context) => context.execute(editorCommandNames.undo),
  },
  {
    id: flowCommandNames.redo,
    label: "Redo",
    accelerator: "Mod+Shift+Z",
    group: "history",
    enabled: (context) => context.canRedo ?? true,
    run: (context) => context.execute(editorCommandNames.redo),
  },
  {
    id: flowCommandNames.selectAll,
    label: "Select All",
    accelerator: "Mod+A",
    group: "selection",
    run: (context) => context.execute(editorCommandNames.selectAll),
  },
  ...([
    [flowCommandNames.bold, "Bold", inlineFormattingSpecs.bold, "Mod+B"],
    [flowCommandNames.italic, "Italic", inlineFormattingSpecs.italic, "Mod+I"],
    [
      flowCommandNames.underline,
      "Underline",
      inlineFormattingSpecs.underline,
      "Mod+U",
    ],
    [
      flowCommandNames.strikethrough,
      "Strikethrough",
      inlineFormattingSpecs.strikethrough,
      "Mod+Shift+U",
    ],
    [flowCommandNames.code, "Code", inlineFormattingSpecs.code, undefined],
    [flowCommandNames.math, "Math", inlineFormattingSpecs.math, undefined],
    [
      flowCommandNames.highlight,
      "Highlight",
      inlineFormattingSpecs.highlight,
      "Mod+Shift+H",
    ],
  ] as const).map(
    ([id, label, spec, accelerator]): Command => ({
      id,
      label,
      accelerator,
      group: "format",
      enabled: isEditable,
      active: activeWrappedSelection(spec),
      run: toggleWrappedSelection(spec),
    }),
  ),
  ...highlightColorSpecs.map(
    ({ color, emoji }): Command => ({
      id: highlightCommandNames[color],
      label: color[0].toUpperCase() + color.slice(1),
      group: "highlight",
      enabled: isEditable,
      active: (context) => {
        const active = checkHighlightColor(context);
        return active.isHighlight
          ? active.color === color
          : selectionText(context).startsWith(`==${emoji}`);
      },
      run: (context) => applyHighlightColor(context, color),
    }),
  ),
  ...Array.from({ length: 6 }, (_value, index) => {
    const level = index + 1;
    return blockCommand(
      flowCommandNames[`heading${level}` as keyof typeof flowCommandNames],
      `Heading ${level}`,
      headingActive(level),
      setHeading(level),
      `Mod+Alt+${level}`,
    );
  }),
  blockCommand(
    flowCommandNames.bulletList,
    "Bulleted List",
    prefixActive(/^[ \t]*[-+*][ \t]+/u),
    togglePrefix(/^[ \t]*[-+*][ \t]+/u, () => "- "),
    "Mod+Shift+8",
  ),
  blockCommand(
    flowCommandNames.orderedList,
    "Numbered List",
    prefixActive(/^[ \t]*\d+\.[ \t]+/u),
    togglePrefix(/^[ \t]*\d+\.[ \t]+/u, (index) => `${index + 1}. `),
    "Mod+Shift+7",
  ),
  blockCommand(
    flowCommandNames.blockquote,
    "Blockquote",
    prefixActive(/^[ \t]*>[ \t]?/u),
    togglePrefix(/^[ \t]*>[ \t]?/u, () => "> "),
  ),
  blockCommand(flowCommandNames.codeBlock, "Code Block", undefined, toggleCodeBlock),
  blockCommand(flowCommandNames.mathBlock, "Math Block", undefined, toggleMathBlock),
  blockCommand(
    flowCommandNames.horizontalRule,
    "Horizontal Rule",
    undefined,
    insertHorizontalRule("---"),
  ),
  blockCommand(
    flowCommandNames.fancyHorizontalRule,
    "∵ Separator",
    undefined,
    insertHorizontalRule("***"),
  ),
  blockCommand(
    flowCommandNames.table,
    "Table",
    undefined,
    (context) => insertTable(context),
  ),
];

export const registerDefaultCommands = (
  registry: CommandRegistry,
): (() => void) => registry.registerMany(createDefaultCommands());

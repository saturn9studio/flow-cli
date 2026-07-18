import {
  createTransaction,
  normalizeRange,
  selectionIsCollapsed,
  type EditorCommand,
  type EditorCommandContext,
  type EditorDocument,
  type EditorKeyBinding,
  type Position,
  type Selection,
} from "../../engine/index.js";

interface ListLine {
  readonly quotePrefix: string;
  readonly indent: string;
  readonly content: string;
  readonly prefixEnd: number;
  readonly nextPrefix: string;
}

interface LineChange {
  readonly paragraph: number;
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export const markdownKeyboardCommandNames = Object.freeze({
  insertLineBreak: "flow.markdown.insertLineBreak",
  deleteBackward: "flow.markdown.deleteBackward",
  indent: "flow.markdown.indent",
  outdent: "flow.markdown.outdent",
});

export const markdownKeyboardKeymap: readonly EditorKeyBinding[] = [
  { key: "Enter", command: markdownKeyboardCommandNames.insertLineBreak },
  { key: "Backspace", command: markdownKeyboardCommandNames.deleteBackward },
  { key: "Tab", command: markdownKeyboardCommandNames.indent },
  { key: "Shift+Tab", command: markdownKeyboardCommandNames.outdent },
];

const quotePrefixPattern = /^(?:(?:[ \t]*>[ \t]?)+)/u;
const listPattern = /^([ \t]*)(?:(\d+)([.)])|([-+*]))([ \t]+)(.*)$/u;
const paragraphText = (doc: EditorDocument, paragraph: number): string =>
  doc.paragraphs[paragraph]?.text ?? "";

const selectedParagraphIndexes = (selection: Selection): readonly number[] => {
  const range = normalizeRange(selection);
  const to =
    range.to.offset === 0 && range.to.paragraph > range.from.paragraph
      ? range.to.paragraph - 1
      : range.to.paragraph;
  return Array.from(
    { length: Math.max(0, to - range.from.paragraph + 1) },
    (_value, index) => range.from.paragraph + index,
  );
};

const parseListLine = (line: string): ListLine | null => {
  const quotePrefix = line.match(quotePrefixPattern)?.[0] ?? "";
  const match = line.slice(quotePrefix.length).match(listPattern);
  if (!match) return null;
  const indent = match[1] ?? "";
  const orderedNumber = match[2];
  const delimiter = match[3];
  const bullet = match[4];
  const spacing = match[5] || " ";
  const content = match[6] ?? "";
  const marker = orderedNumber ? `${orderedNumber}${delimiter}` : bullet ?? "-";
  const nextMarker = orderedNumber
    ? `${Number.parseInt(orderedNumber, 10) + 1}${delimiter}`
    : marker;
  return {
    quotePrefix,
    indent,
    content,
    prefixEnd: quotePrefix.length + indent.length + marker.length + spacing.length,
    nextPrefix: `${quotePrefix}${indent}${nextMarker}${spacing}`,
  };
};

const parseQuoteLine = (
  line: string,
): { readonly prefix: string; readonly content: string } | null => {
  const prefix = line.match(quotePrefixPattern)?.[0] ?? "";
  return prefix ? { prefix, content: line.slice(prefix.length) } : null;
};

const trailingIndentUnit = (indent: string): number => {
  if (indent.endsWith("\t")) return 1;
  return Math.min(2, indent.match(/ +$/u)?.[0].length ?? 0);
};

const adjustPosition = (
  position: Position,
  changes: readonly LineChange[],
): Position =>
  changes.reduce((next, change) => {
    if (next.paragraph !== change.paragraph || next.offset < change.from) return next;
    return {
      ...next,
      offset: Math.max(
        change.from,
        next.offset + change.insert.length - (change.to - change.from),
      ),
    };
  }, position);

const dispatchLineChanges = (
  context: EditorCommandContext,
  changes: readonly LineChange[],
): void => {
  const transaction = createTransaction(context.doc, context.selection);
  changes.forEach((change) => {
    transaction.replaceRange(
      { paragraph: change.paragraph, offset: change.from },
      { paragraph: change.paragraph, offset: change.to },
      change.insert,
    );
  });
  transaction.setSelection({
    anchor: adjustPosition(context.selection.anchor, changes),
    head: adjustPosition(context.selection.head, changes),
  });
  context.dispatch(transaction.build());
};

const exitPrefix = (
  context: EditorCommandContext,
  paragraph: number,
  from: number,
  to: number,
): boolean => {
  const caret = { paragraph, offset: from };
  context.dispatch(
    createTransaction(context.doc, context.selection)
      .replaceRange({ paragraph, offset: from }, { paragraph, offset: to }, "")
      .setSelection({ anchor: caret, head: caret })
      .build(),
  );
  return true;
};

const outdentList = (
  context: EditorCommandContext,
  paragraph: number,
  list: ListLine,
): boolean => {
  const count = trailingIndentUnit(list.indent);
  if (count === 0) return false;
  const to = list.quotePrefix.length + list.indent.length;
  dispatchLineChanges(context, [{
    paragraph,
    from: to - count,
    to,
    insert: "",
  }]);
  return true;
};

export const handleMarkdownEnter = (
  context: EditorCommandContext,
): boolean => {
  if (context.readOnly || !selectionIsCollapsed(context.selection)) return false;
  const position = context.selection.head;
  const line = paragraphText(context.doc, position.paragraph);
  const list = parseListLine(line);
  if (list) {
    if (position.offset < list.prefixEnd) return false;
    if (list.content.trim().length === 0) {
      return outdentList(context, position.paragraph, list) ||
        exitPrefix(
          context,
          position.paragraph,
          list.quotePrefix.length,
          list.prefixEnd,
        );
    }
    const caret = {
      paragraph: position.paragraph + 1,
      offset: list.nextPrefix.length,
    };
    context.dispatch(
      createTransaction(context.doc, context.selection)
        .replaceRange(position, position, `\n${list.nextPrefix}`)
        .setSelection({ anchor: caret, head: caret })
        .build(),
    );
    return true;
  }
  const quote = parseQuoteLine(line);
  if (!quote || position.offset < quote.prefix.length) return false;
  if (quote.content.trim().length === 0) {
    return exitPrefix(context, position.paragraph, 0, quote.prefix.length);
  }
  const caret = {
    paragraph: position.paragraph + 1,
    offset: quote.prefix.length,
  };
  context.dispatch(
    createTransaction(context.doc, context.selection)
      .replaceRange(position, position, `\n${quote.prefix}`)
      .setSelection({ anchor: caret, head: caret })
      .build(),
  );
  return true;
};

export const handleMarkdownBackspace = (
  context: EditorCommandContext,
): boolean => {
  if (context.readOnly || !selectionIsCollapsed(context.selection)) return false;
  const position = context.selection.head;
  const line = paragraphText(context.doc, position.paragraph);
  const list = parseListLine(line);
  if (list) {
    if (position.offset > list.prefixEnd && list.content.trim().length > 0) return false;
    return outdentList(context, position.paragraph, list) ||
      exitPrefix(
        context,
        position.paragraph,
        list.quotePrefix.length,
        list.prefixEnd,
      );
  }
  const quote = parseQuoteLine(line);
  if (!quote) return false;
  if (position.offset > quote.prefix.length && quote.content.trim().length > 0) {
    return false;
  }
  return exitPrefix(context, position.paragraph, 0, quote.prefix.length);
};

const selectedListChanges = (
  context: EditorCommandContext,
  transform: (
    list: ListLine,
    paragraph: number,
  ) => LineChange | null,
): readonly LineChange[] =>
  selectedParagraphIndexes(context.selection)
    .map((paragraph) => {
      const list = parseListLine(paragraphText(context.doc, paragraph));
      return list ? transform(list, paragraph) : null;
    })
    .filter((change): change is LineChange => change !== null);

export const handleMarkdownIndent = (
  context: EditorCommandContext,
): boolean => {
  if (context.readOnly) return false;
  const changes = selectedListChanges(context, (list, paragraph) => ({
    paragraph,
    from: list.quotePrefix.length,
    to: list.quotePrefix.length,
    insert: "\t",
  }));
  if (changes.length > 0) {
    dispatchLineChanges(context, changes);
    return true;
  }
  context.dispatch(
    createTransaction(context.doc, context.selection)
      .replaceSelection("\t")
      .build(),
  );
  return true;
};

export const handleMarkdownOutdent = (
  context: EditorCommandContext,
): boolean => {
  if (context.readOnly) return false;
  const changes = selectedListChanges(context, (list, paragraph) => {
    const count = trailingIndentUnit(list.indent);
    if (count === 0) return null;
    const to = list.quotePrefix.length + list.indent.length;
    return { paragraph, from: to - count, to, insert: "" };
  });
  if (changes.length === 0) return false;
  dispatchLineChanges(context, changes);
  return true;
};

export const markdownKeyboardCommands: readonly EditorCommand[] = [
  { name: markdownKeyboardCommandNames.insertLineBreak, run: handleMarkdownEnter },
  { name: markdownKeyboardCommandNames.deleteBackward, run: handleMarkdownBackspace },
  { name: markdownKeyboardCommandNames.indent, run: handleMarkdownIndent },
  { name: markdownKeyboardCommandNames.outdent, run: handleMarkdownOutdent },
];

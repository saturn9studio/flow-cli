import {
  absoluteOffset,
  createTransaction,
  normalizeRange,
  positionFromOffset,
  selectionIsCollapsed,
  textInRange,
  type EditorCommandContext,
  type EditorSnapshot,
  type TerminalEditor,
} from "../../engine/index.js";
import {
  buildMarkdownImage,
  buildMarkdownLink,
  imageAtRange,
  linkAtRange,
} from "../presentation/spans.js";

export interface LinkCommandArgs {
  readonly action: "check" | "apply" | "remove";
  readonly text?: string;
  readonly url?: string;
  readonly title?: string;
}

export interface LinkResult {
  readonly isLink: boolean;
  readonly text: string;
  readonly url: string;
  readonly title: string;
  readonly from?: number;
  readonly to?: number;
}

export interface ImageCommandArgs {
  readonly action: "check" | "apply" | "remove" | "select";
  readonly src?: string;
  readonly alt?: string;
  readonly title?: string;
}

export interface ImageResult {
  readonly isImage: boolean;
  readonly src: string;
  readonly alt: string;
  readonly title: string;
}

export interface TableCommandArgs {
  readonly rows?: number;
  readonly columns?: number;
  readonly headers?: readonly string[];
  readonly cells?: readonly (readonly string[])[];
}

const absoluteSelectionRange = (
  context: EditorSnapshot,
): { readonly from: number; readonly to: number } => {
  const range = normalizeRange(context.selection);
  return {
    from: absoluteOffset(context.doc, range.from),
    to: absoluteOffset(context.doc, range.to),
  };
};

const selectedText = (context: EditorSnapshot): string =>
  textInRange(context.doc, normalizeRange(context.selection));

const runWithEditor = <T>(
  editor: TerminalEditor,
  run: (context: EditorCommandContext) => T,
): T => {
  const snapshot = editor.snapshot();
  return run({
    ...snapshot,
    dispatch: (transaction) => editor.dispatch(transaction),
    execute: (commandName) => editor.execute(commandName),
  });
};

export const checkLink = (context: EditorSnapshot): LinkResult => {
  const link = linkAtRange(context.content, absoluteSelectionRange(context));
  return link
    ? {
        isLink: true,
        text: link.text,
        url: link.url,
        title: link.title ?? "",
        from: link.from,
        to: link.to,
      }
    : {
        isLink: false,
        text: selectedText(context),
        url: "",
        title: "",
      };
};

export const applyLink = (
  context: EditorCommandContext,
  args: { readonly text?: string; readonly url: string; readonly title?: string },
): boolean => {
  if (context.readOnly || args.url.trim().length === 0) return false;
  const selected = absoluteSelectionRange(context);
  const existing = linkAtRange(context.content, selected);
  const replacement = buildMarkdownLink({
    text: args.text ?? existing?.text ?? selectedText(context),
    url: args.url.trim(),
    title: args.title?.trim() || undefined,
  });
  context.dispatch(
    createTransaction(context.doc, context.selection)
      .replaceRange(
        positionFromOffset(context.doc, existing?.from ?? selected.from),
        positionFromOffset(context.doc, existing?.to ?? selected.to),
        replacement,
      )
      .build(),
  );
  return true;
};

export const removeLink = (context: EditorCommandContext): boolean => {
  if (context.readOnly) return false;
  const link = linkAtRange(context.content, absoluteSelectionRange(context));
  if (!link) return false;
  context.dispatch(
    createTransaction(context.doc, context.selection)
      .replaceRange(
        positionFromOffset(context.doc, link.from),
        positionFromOffset(context.doc, link.to),
        link.text,
      )
      .build(),
  );
  return true;
};

export const executeLinkAction = (
  editor: TerminalEditor,
  args: LinkCommandArgs,
): LinkResult | boolean =>
  runWithEditor(editor, (context) => {
    switch (args.action) {
      case "check":
        return checkLink(context);
      case "apply":
        return args.url ? applyLink(context, { ...args, url: args.url }) : false;
      case "remove":
        return removeLink(context);
    }
  });

export const checkImage = (context: EditorSnapshot): ImageResult => {
  const image = imageAtRange(context.content, absoluteSelectionRange(context));
  return image
    ? {
        isImage: true,
        src: image.src,
        alt: image.alt,
        title: image.title ?? "",
      }
    : { isImage: false, src: "", alt: "", title: "" };
};

export const applyImage = (
  context: EditorCommandContext,
  args: { readonly src: string; readonly alt?: string; readonly title?: string },
): boolean => {
  if (context.readOnly || args.src.trim().length === 0) return false;
  const selected = absoluteSelectionRange(context);
  const existing = imageAtRange(context.content, selected);
  context.dispatch(
    createTransaction(context.doc, context.selection)
      .replaceRange(
        positionFromOffset(context.doc, existing?.from ?? selected.from),
        positionFromOffset(context.doc, existing?.to ?? selected.to),
        buildMarkdownImage({
          src: args.src.trim(),
          alt: args.alt ?? existing?.alt ?? "",
          title: args.title?.trim() || undefined,
        }),
      )
      .build(),
  );
  return true;
};

export const removeImage = (context: EditorCommandContext): boolean => {
  if (context.readOnly) return false;
  const image = imageAtRange(context.content, absoluteSelectionRange(context));
  if (!image) return false;
  context.dispatch(
    createTransaction(context.doc, context.selection)
      .replaceRange(
        positionFromOffset(context.doc, image.from),
        positionFromOffset(context.doc, image.to),
        "",
      )
      .build(),
  );
  return true;
};

export const executeImageAction = (
  editor: TerminalEditor,
  args: ImageCommandArgs,
): ImageResult | boolean =>
  runWithEditor(editor, (context) => {
    switch (args.action) {
      case "check":
        return checkImage(context);
      case "apply":
        return args.src ? applyImage(context, { ...args, src: args.src }) : false;
      case "remove":
        return removeImage(context);
      case "select": {
        const image = imageAtRange(context.content, absoluteSelectionRange(context));
        if (!image) return false;
        const selection = {
          anchor: positionFromOffset(context.doc, image.from),
          head: positionFromOffset(context.doc, image.to),
        };
        context.dispatch(
          createTransaction(context.doc, context.selection)
            .setSelection(selection)
            .build(),
        );
        return true;
      }
    }
  });

export const buildMarkdownTable = ({
  rows = 1,
  columns = 3,
  headers,
  cells,
}: TableCommandArgs = {}): string => {
  const columnCount = Math.max(1, columns, headers?.length ?? 0);
  const rowCount = Math.max(1, rows);
  const headerRow = Array.from(
    { length: columnCount },
    (_value, index) => headers?.[index] ?? `Header ${index + 1}`,
  );
  const bodyRows = Array.from({ length: rowCount }, (_value, rowIndex) =>
    Array.from(
      { length: columnCount },
      (_cell, columnIndex) => cells?.[rowIndex]?.[columnIndex] ?? "",
    ),
  );
  return [
    `| ${headerRow.join(" | ")} |`,
    `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
    ...bodyRows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
};

export const insertTable = (
  context: EditorCommandContext,
  args: TableCommandArgs = {},
): boolean => {
  if (context.readOnly) return false;
  const range = normalizeRange(context.selection);
  const paragraphLength =
    context.doc.paragraphs[range.to.paragraph]?.text.length ?? 0;
  const before = range.from.offset === 0 ? "" : "\n";
  const after = range.to.offset === paragraphLength ? "" : "\n";
  const table = `${before}${buildMarkdownTable(args)}${after}`;
  const transaction = createTransaction(context.doc, context.selection)
    .replaceRange(range.from, range.to, table);
  if (selectionIsCollapsed(context.selection)) {
    const firstCellOffset = table.indexOf("Header 1");
    if (firstCellOffset >= 0) {
      const selectionFrom = absoluteOffset(context.doc, range.from) + firstCellOffset;
      transaction.setSelection({
        anchor: positionFromOffset(transaction.doc, selectionFrom),
        head: positionFromOffset(
          transaction.doc,
          selectionFrom + "Header 1".length,
        ),
      });
    }
  }
  context.dispatch(transaction.build());
  return true;
};

export const executeTableInsert = (
  editor: TerminalEditor,
  args: TableCommandArgs = {},
): boolean => runWithEditor(editor, (context) => insertTable(context, args));

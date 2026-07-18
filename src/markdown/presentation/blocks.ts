import {
  absoluteOffset,
  normalizeRange,
  PluginId,
  positionFromOffset,
  type EditorDocument,
  type EditorPlugin,
  type Selection,
  type WidgetDecoration,
  type WidgetRenderer,
  type WidgetTextRun,
} from "../../engine/index.js";
import { highlightCode } from "../code-highlight.js";
import { withInactiveFocusStyle } from "../focus.js";
import {
  findFlowCliMarkdownFences,
  findFlowCliMarkdownMathBlocks,
} from "./parser.js";

export type MarkdownBlockPresentationMode = "edit" | "source" | "focus" | "read";

export interface CodeBlockWidgetProps {
  readonly language: string;
}

export interface MathBlockWidgetProps {
  readonly language: "latex";
}

export interface TableWidgetProps {
  readonly rows: readonly (readonly string[])[];
}

export interface TaskWidgetProps {
  readonly checked: boolean;
  readonly checkedText?: string;
  readonly uncheckedText?: string;
}

export interface MarkdownBlockWidgetOptions {
  readonly mode?: MarkdownBlockPresentationMode;
  readonly code?: boolean | WidgetRenderer<CodeBlockWidgetProps>;
  readonly math?: boolean | WidgetRenderer<MathBlockWidgetProps>;
  readonly tables?: boolean | WidgetRenderer<TableWidgetProps>;
  readonly tasks?: boolean | WidgetRenderer<TaskWidgetProps>;
}

interface SourceBlock {
  readonly from: number;
  readonly to: number;
}

const selectionTouches = (
  doc: EditorDocument,
  selection: Selection,
  block: SourceBlock,
): boolean => {
  const range = normalizeRange(selection);
  const from = absoluteOffset(doc, range.from);
  const to = absoluteOffset(doc, range.to);
  if (from === to) return block.from < from && from <= block.to;
  return from <= block.to && to >= block.from;
};

const blocksOverlap = (a: SourceBlock, b: SourceBlock): boolean =>
  a.from < b.to && a.to > b.from;

const selectionTouchesTableEditingZone = (
  doc: EditorDocument,
  selection: Selection,
  block: SourceBlock,
): boolean => {
  if (selectionTouches(doc, selection, block)) return true;
  const range = normalizeRange(selection);
  if (
    range.from.paragraph !== range.to.paragraph ||
    range.from.offset !== range.to.offset
  ) {
    return false;
  }
  const end = positionFromOffset(doc, block.to);
  return (
    range.from.paragraph === end.paragraph &&
    range.from.offset >= end.offset
  ) || range.from.paragraph === end.paragraph + 1;
};

const crop = (text: string, width: number): string => {
  if (width <= 0) return "";
  const characters = [...text];
  return characters.length <= width
    ? text
    : width === 1 ? "…" : `${characters.slice(0, width - 1).join("")}…`;
};

const cropRuns = (
  runs: readonly WidgetTextRun[],
  width: number,
): readonly WidgetTextRun[] => {
  if (width <= 0) return [];
  const cropped: WidgetTextRun[] = [];
  let remaining = width;
  for (const run of runs) {
    if (remaining <= 0) break;
    const characters = [...run.text];
    if (characters.length <= remaining) {
      cropped.push(run);
      remaining -= characters.length;
      continue;
    }
    const visible = remaining === 1
      ? "…"
      : `${characters.slice(0, remaining - 1).join("")}…`;
    cropped.push({ ...run, text: visible });
    remaining = 0;
  }
  return cropped;
};

const sourceHandoff = (
  context: Parameters<NonNullable<WidgetRenderer["handleInput"]>>[0],
): boolean => {
  if (context.event.kind !== "key") return false;
  if (context.event.key === "Enter" || context.event.key === "Escape") {
    context.focusEditor();
    return true;
  }
  if (context.event.key === "Delete" || context.event.key === "Backspace") {
    return context.deleteSelf();
  }
  return false;
};

export const defaultCodeBlockRenderer: WidgetRenderer<CodeBlockWidgetProps> = {
  render: ({ props, sourceText, width, focused }) => {
    const lines = sourceText.split("\n");
    const body = lines.slice(1, -1);
    const label = focused && props.language ? `code · ${props.language}` : "code";
    const highlighted = highlightCode(body.join("\n"), props.language);
    return {
      lines: [
        ...(focused
          ? [[{
              text: crop(label, width),
              style: { role: "codeBlockLabel", dim: true },
            }]]
          : []),
        ...highlighted.map((line) => cropRuns(line, width)),
      ],
    };
  },
  handleInput: sourceHandoff,
};

export const defaultMathBlockRenderer: WidgetRenderer<MathBlockWidgetProps> = {
  render: ({ props, sourceText, width, focused }) => {
    const lines = sourceText.split("\n");
    const body = lines.slice(1, -1);
    const highlighted = highlightCode(body.join("\n"), props.language);
    return {
      lines: [
        ...(focused
          ? [[{
              text: crop("math · latex", width),
              style: { role: "codeBlockLabel", dim: true },
            }]]
          : []),
        ...highlighted.map((line) => cropRuns(line, width)),
      ],
    };
  },
  handleInput: sourceHandoff,
};

export const defaultTableRenderer: WidgetRenderer<TableWidgetProps> = {
  render: ({ props, width }) => {
    const columnCount = Math.max(1, ...props.rows.map((row) => row.length));
    const cellWidth = Math.max(1, Math.floor((width - columnCount - 1) / columnCount));
    const border = (
      left: string,
      junction: string,
      right: string,
    ): readonly WidgetTextRun[] => [{
      text: `${left}${Array.from(
        { length: columnCount },
        () => "─".repeat(cellWidth),
      ).join(junction)}${right}`,
      style: { role: "tableBorder", dim: true },
    }];
    const row = (
      cells: readonly string[],
      role: string,
    ): readonly WidgetTextRun[] => [
      { text: "│", style: { role: "tableBorder", dim: true } },
      ...Array.from({ length: columnCount }, (_value, index) => [
        {
          text: crop(cells[index]?.trim() ?? "", cellWidth).padEnd(cellWidth),
          style: { role },
        },
        { text: "│", style: { role: "tableBorder", dim: true } },
      ]).flat(),
    ];
    const [header = [], ...body] = props.rows;
    return {
      lines: [
        border("┌", "┬", "┐"),
        row(header, "tableHeader"),
        border("├", "┼", "┤"),
        ...body.map((cells) => row(cells, "tableCell")),
        border("└", "┴", "┘"),
      ],
    };
  },
  handleInput: sourceHandoff,
};

export const defaultTaskRenderer: WidgetRenderer<TaskWidgetProps> = {
  render: ({ props }) => ({
    lines: [[{
      text: props.checked
        ? props.checkedText ?? "[x]"
        : props.uncheckedText ?? "[ ]",
      style: { role: props.checked ? "taskChecked" : "taskUnchecked" },
    }]],
  }),
  handleInput(context) {
    if (context.event.kind !== "key") return false;
    if (context.event.key === " " || context.event.key === "Enter") {
      return context.replaceSelf(context.props.checked ? "[ ]" : "[x]");
    }
    return sourceHandoff(context);
  },
};

const codeBlockPattern = /^```([^\n`]*)\n[\s\S]*?\n```[ \t]*(?=\n|$)/gmu;
const tableBlockPattern =
  /^(?:[ \t]*\|[^\n]*\|[ \t]*\n)[ \t]*\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*(?:\n[ \t]*\|[^\n]*\|[ \t]*)+/gmu;
const taskPattern = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+)(\[[ xX]\])/gmu;

const tableRows = (source: string): readonly (readonly string[])[] =>
  source
    .split("\n")
    .filter((_line, index) => index !== 1)
    .map((line) => line.trim().replace(/^\||\|$/gu, "").split("|"));

export const createMarkdownBlockWidgets = (
  doc: EditorDocument,
  selection: Selection,
  content: string,
  options: MarkdownBlockWidgetOptions = {},
): readonly WidgetDecoration[] => {
  const mode = options.mode ?? "edit";
  if (mode === "source") return [];
  const revealsSource = mode !== "read";
  const widgets: WidgetDecoration[] = [];
  const fenceBlocks = findFlowCliMarkdownFences(content);
  const mathBlocks = findFlowCliMarkdownMathBlocks(content);
  const codeMatches = [...content.matchAll(codeBlockPattern)]
    .map((match) => {
      const from = match.index ?? 0;
      return { match, block: { from, to: from + match[0].length } };
    });
  const codeBlocks = codeMatches.map(({ block }) => block);
  if (options.code !== false) {
    for (const { match, block } of codeMatches) {
      const from = match.index ?? 0;
      if (
        mathBlocks.some((mathBlock) =>
          mathBlock.from < block.from && blocksOverlap(mathBlock, block)
        )
      ) {
        continue;
      }
      if (revealsSource && selectionTouches(doc, selection, block)) continue;
      widgets.push({
        key: `scribecli.code:${from}`,
        placement: "block",
        range: {
          from: positionFromOffset(doc, block.from),
          to: positionFromOffset(doc, block.to),
        },
        props: {
          language: match[1]?.trim().split(/\s+/u)[0] ?? "",
        },
        render: mode === "focus"
          ? withInactiveFocusStyle(
              typeof options.code === "object"
                ? options.code
                : defaultCodeBlockRenderer,
            )
          : typeof options.code === "object"
            ? options.code
            : defaultCodeBlockRenderer,
        selection: "block",
        focusable: true,
      });
    }
  }
  if (options.math !== false) {
    for (const mathBlock of mathBlocks) {
      const block = { from: mathBlock.from, to: mathBlock.to };
      if (
        [...fenceBlocks, ...codeBlocks].some((fenceBlock) =>
          fenceBlock.from < block.from && blocksOverlap(fenceBlock, block)
        )
      ) {
        continue;
      }
      if (revealsSource && selectionTouches(doc, selection, block)) continue;
      widgets.push({
        key: `scribecli.math:${mathBlock.from}`,
        placement: "block",
        range: {
          from: positionFromOffset(doc, block.from),
          to: positionFromOffset(doc, block.to),
        },
        props: { language: "latex" },
        render: mode === "focus"
          ? withInactiveFocusStyle(
              typeof options.math === "object"
                ? options.math
                : defaultMathBlockRenderer,
            )
          : typeof options.math === "object"
            ? options.math
            : defaultMathBlockRenderer,
        selection: "block",
        focusable: true,
      });
    }
  }
  if (options.tables !== false) {
    for (const match of content.matchAll(tableBlockPattern)) {
      const from = match.index ?? 0;
      const block = { from, to: from + match[0].length };
      if (
        revealsSource &&
        selectionTouchesTableEditingZone(doc, selection, block)
      ) {
        continue;
      }
      widgets.push({
        key: `scribecli.table:${from}`,
        placement: "block",
        range: {
          from: positionFromOffset(doc, block.from),
          to: positionFromOffset(doc, block.to),
        },
        props: { rows: tableRows(match[0]) },
        render: typeof options.tables === "object"
          ? options.tables
          : defaultTableRenderer,
        selection: "block",
      });
    }
  }
  if (options.tasks !== false) {
    for (const match of content.matchAll(taskPattern)) {
      const marker = match[2] ?? "[ ]";
      const from = (match.index ?? 0) + (match[1]?.length ?? 0);
      const block = { from, to: from + marker.length };
      if (revealsSource && selectionTouches(doc, selection, block)) continue;
      widgets.push({
        key: `scribecli.task:${from}`,
        placement: "inline",
        range: {
          from: positionFromOffset(doc, block.from),
          to: positionFromOffset(doc, block.to),
        },
        props: { checked: /\[[xX]\]/u.test(marker) },
        render: typeof options.tasks === "object"
          ? options.tasks
          : defaultTaskRenderer,
        selection: "atom",
      });
    }
  }
  return widgets;
};

interface MarkdownBlockPluginState {
  readonly sourceRevision: number;
}

export const markdownBlockWidgetsPlugin = (
  options: MarkdownBlockWidgetOptions = {},
): EditorPlugin<MarkdownBlockPluginState> => ({
  id: markdownBlockWidgetsPluginId,
  init: ({ syntax }) => ({ sourceRevision: syntax.version }),
  apply: ({ syntax }) => ({ sourceRevision: syntax.version }),
  widgets: ({ doc, selection, content }) =>
    createMarkdownBlockWidgets(doc, selection, content, options),
});

export const markdownBlockWidgetsPluginId =
  new PluginId<MarkdownBlockPluginState>("scribecli.markdown-block-widgets");

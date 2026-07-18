import {
  graphemeCellWidth,
  printableGrapheme,
  textCellWidth,
  type AmbiguousWidth,
} from "./cellWidth.js";
import type {
  EditorDecoration,
  ReplaceDecoration,
  ConcealDecoration,
  TextStyle,
  WidgetDecoration,
  WidgetGraphic,
  WidgetTextRun,
} from "./decorations.js";
import {
  type Cell,
  type FrameGraphic,
  type FrameRow,
  type LayoutResult,
  type WidgetLayoutRegion,
} from "./frame.js";
import {
  type EditorDocument,
  type Position,
  absoluteOffset,
  graphemeSegments,
  positionFromOffset,
  textInRange,
} from "./model.js";

interface ProjectionUnit {
  readonly text: string;
  readonly style: TextStyle;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly positionBefore: number;
  readonly positionAfter: number;
}

const mergeStyles = (styles: readonly TextStyle[]): TextStyle =>
  styles.reduce<TextStyle>((merged, style) => ({ ...merged, ...style }), {});

const styleAt = (
  decorations: readonly EditorDecoration[],
  from: number,
  to: number,
): TextStyle =>
  mergeStyles(
    decorations
      .filter(
        (decoration) =>
          decoration.kind === "inline" && decoration.from < to && decoration.to > from,
      )
      .map((decoration) => decoration.kind === "inline" ? decoration.style : {}),
  );

const backgroundRoleAt = (
  decorations: readonly EditorDecoration[],
  from: number,
  to: number,
): string | undefined => {
  for (let index = decorations.length - 1; index >= 0; index -= 1) {
    const decoration = decorations[index];
    if (
      decoration?.kind === "line" &&
      decoration.from < to &&
      decoration.to > from
    ) {
      return decoration.backgroundRole;
    }
  }
  return undefined;
};

const withBackgroundRole = (
  style: TextStyle,
  backgroundRole: string | undefined,
): TextStyle =>
  backgroundRole ? { ...style, backgroundRole } : style;

const coveringReplacement = (
  decorations: readonly EditorDecoration[],
  offset: number,
): ReplaceDecoration | ConcealDecoration | undefined =>
  decorations.find(
    (decoration): decoration is ReplaceDecoration | ConcealDecoration =>
      (decoration.kind === "replace" || decoration.kind === "conceal") &&
      decoration.from === offset,
  );

const projectionUnits = (
  doc: EditorDocument,
  decorations: readonly EditorDecoration[],
): readonly ProjectionUnit[] => {
  const text = doc.paragraphs.map((item) => item.text).join("\n");
  const units: ProjectionUnit[] = [];
  let offset = 0;

  while (offset < text.length) {
    const replacement = coveringReplacement(decorations, offset);
    if (replacement) {
      const to = Math.max(offset, replacement.to);
      const replacementText = replacement.kind === "conceal" ? "" : replacement.text;
      const laterStyle = styleAt(
        decorations.slice(decorations.indexOf(replacement) + 1),
        offset,
        to,
      );
      units.push({
        text: replacementText,
        style: withBackgroundRole(
          replacement.kind === "replace"
            ? mergeStyles([replacement.style ?? {}, laterStyle])
            : laterStyle,
          backgroundRoleAt(decorations, offset, to),
        ),
        sourceFrom: offset,
        sourceTo: to,
        positionBefore: offset,
        positionAfter: to,
      });
      offset = to;
      continue;
    }

    const segment = graphemeSegments(text.slice(offset))[0];
    if (!segment) break;
    const end = offset + segment.segment.length;
    units.push({
      text: segment.segment,
      style: withBackgroundRole(
        styleAt(decorations, offset, end),
        backgroundRoleAt(decorations, offset, end),
      ),
      sourceFrom: offset,
      sourceTo: end,
      positionBefore: offset,
      positionAfter: end,
    });
    offset = end;
  }

  if (text.length === 0) return [];
  return units;
};

const lineToRuns = (
  line: string | readonly WidgetTextRun[],
): readonly WidgetTextRun[] => typeof line === "string" ? [{ text: line }] : line;

const renderBlockWidget = (
  doc: EditorDocument,
  widget: WidgetDecoration,
  width: number,
  readOnly: boolean,
  focused: boolean,
  ambiguousWidth: AmbiguousWidth,
): { readonly rows: readonly FrameRow[]; readonly graphic?: WidgetGraphic } => {
  const result = widget.render.render({
    props: widget.props,
    sourceText: textInRange(doc, widget.range),
    width,
    readOnly,
    focused,
  });
  const rows = result.lines.map((line) => {
    const cells: Cell[] = [];
    for (const run of lineToRuns(line)) {
      for (const segment of graphemeSegments(run.text)) {
        const rendered = printableGrapheme(segment.segment);
        const cellWidth = graphemeCellWidth(rendered, ambiguousWidth);
        if (cells.length + Math.max(1, cellWidth) > width) break;
        cells.push({ text: rendered, style: run.style ?? {} });
        if (cellWidth === 2) cells.push({ text: "", style: run.style ?? {}, continuation: true });
      }
    }
    return { cells };
  });
  return { rows, graphic: result.graphic };
};

const selectionStyle = (selected: boolean): TextStyle =>
  selected ? { role: "selection", inverse: true } : {};

export interface LayoutOptions {
  readonly width: number;
  readonly tabSize?: number;
  readonly readOnly?: boolean;
  readonly decorations?: readonly EditorDecoration[];
  readonly widgets?: readonly WidgetDecoration[];
  readonly focusedWidgetKey?: string;
  readonly ambiguousWidth?: AmbiguousWidth;
  readonly selectionFrom?: number;
  readonly selectionTo?: number;
}

export const layoutDocument = (
  doc: EditorDocument,
  options: LayoutOptions,
): LayoutResult => {
  const width = Math.max(1, options.width);
  const decorations = options.decorations ?? [];
  const units = projectionUnits(doc, decorations);
  const rows: FrameRow[] = [];
  const widgetRegions: WidgetLayoutRegion[] = [];
  const graphics: FrameGraphic[] = [];
  const positionPoints: { row: number; column: number }[] = Array.from(
    { length: doc.paragraphs.reduce((n, item) => n + item.text.length + 1, 0) },
    () => ({ row: 0, column: 0 }),
  );
  let cells: Cell[] = [];
  let backgroundRole: string | undefined;
  let row = 0;
  let column = 0;
  let trailingParagraphRow = false;

  const pushRow = (): void => {
    rows.push(backgroundRole ? { cells, backgroundRole } : { cells });
    cells = [];
    backgroundRole = undefined;
    row += 1;
    column = 0;
  };

  const setMappings = (from: number, to: number, before: boolean): void => {
    const point = { row, column };
    for (let index = from; index <= to && index < positionPoints.length; index += 1) {
      if (before || positionPoints[index]?.row === 0 && positionPoints[index]?.column === 0) {
        positionPoints[index] = point;
      }
    }
  };

  const widgetsByStart = new Map<number, WidgetDecoration[]>();
  for (const widget of options.widgets ?? []) {
    const start = absoluteOffset(doc, widget.range.from);
    widgetsByStart.set(start, [...(widgetsByStart.get(start) ?? []), widget]);
  }

  let widgetSourceEnd = -1;
  let blockWidgetBoundaryNewline = -1;
  for (const unit of units) {
    if (
      unit.sourceFrom < widgetSourceEnd ||
      unit.sourceFrom === blockWidgetBoundaryNewline && unit.text === "\n"
    ) {
      const point = { row, column };
      for (
        let index = unit.positionBefore;
        index <= unit.positionAfter && index < positionPoints.length;
        index += 1
      ) {
        positionPoints[index] = point;
      }
      if (unit.sourceFrom === blockWidgetBoundaryNewline) {
        blockWidgetBoundaryNewline = -1;
      }
      continue;
    }

    const widgets = widgetsByStart.get(unit.sourceFrom) ?? [];
    if (widgets.length > 0) {
      const widget = widgets[0];
      const sourceEnd = absoluteOffset(doc, widget.range.to);
      const before = { row, column };
      if (widget.placement === "block") {
        if (cells.length > 0) pushRow();
        const renderedWidget = renderBlockWidget(
          doc,
          widget,
          width,
          options.readOnly ?? false,
          options.focusedWidgetKey === widget.key,
          options.ambiguousWidth ?? 1,
        );
        const widgetRows = renderedWidget.rows.map((widgetRow) => ({
          ...widgetRow,
          ...(unit.style.backgroundRole
            ? { backgroundRole: unit.style.backgroundRole }
            : {}),
          cells: widgetRow.cells.map((cell) => ({
            ...cell,
            style: withBackgroundRole(
              cell.style,
              unit.style.backgroundRole,
            ),
          })),
        }));
        if (renderedWidget.graphic && widgetRows.length > 0) {
          graphics.push({
            key: widget.key,
            row: rows.length,
            column: 0,
            columns: Math.max(1, ...widgetRows.map((item) => item.cells.length)),
            rows: widgetRows.length,
            image: renderedWidget.graphic,
          });
        }
        widgetRows.forEach((widgetRow, index) => {
          widgetRegions.push({
            key: widget.key,
            placement: widget.placement,
            range: widget.range,
            row: rows.length + index,
            columnFrom: 0,
            columnTo: Math.max(1, widgetRow.cells.length),
          });
        });
        rows.push(...widgetRows);
        row = rows.length;
        column = 0;
        if (
          widget.range.to.offset ===
            (doc.paragraphs[widget.range.to.paragraph]?.text.length ?? -1) &&
          widget.range.to.paragraph + 1 < doc.paragraphs.length
        ) {
          blockWidgetBoundaryNewline = sourceEnd;
        }
      } else {
        const rendered = widget.render.render({
          props: widget.props,
          sourceText: textInRange(doc, widget.range),
          width: Math.max(1, width - column),
          readOnly: options.readOnly ?? false,
          focused: options.focusedWidgetKey === widget.key,
        });
        if (rendered.lines.length > 1) {
          throw new Error(
            `Inline widget "${widget.key}" returned ${rendered.lines.length} lines; inline widgets must render at most one line.`,
          );
        }
        const runs = lineToRuns(rendered.lines[0] ?? "");
        let regionRow = row;
        let regionFrom = column;
        for (const run of runs) {
          for (const segment of graphemeSegments(run.text)) {
            const renderedText = printableGrapheme(segment.segment);
            const cellWidth = Math.max(
              1,
              graphemeCellWidth(renderedText, options.ambiguousWidth),
            );
            if (column > 0 && column + cellWidth > width) {
              widgetRegions.push({
                key: widget.key,
                placement: widget.placement,
                range: widget.range,
                row: regionRow,
                columnFrom: regionFrom,
                columnTo: column,
              });
              pushRow();
              regionRow = row;
              regionFrom = column;
            }
            backgroundRole ??= unit.style.backgroundRole;
            const style = withBackgroundRole(
              run.style ?? {},
              unit.style.backgroundRole,
            );
            cells.push({
              text: renderedText,
              style,
              sourceFrom: unit.sourceFrom,
              sourceTo: sourceEnd,
            });
            if (cellWidth === 2) {
              cells.push({
                text: "",
                style,
                continuation: true,
                sourceFrom: unit.sourceFrom,
                sourceTo: sourceEnd,
              });
            }
            column += cellWidth;
          }
        }
        widgetRegions.push({
          key: widget.key,
          placement: widget.placement,
          range: widget.range,
          row: regionRow,
          columnFrom: regionFrom,
          columnTo: Math.max(regionFrom + 1, column),
        });
      }
      const after = { row, column };
      for (
        let index = unit.sourceFrom;
        index <= sourceEnd && index < positionPoints.length;
        index += 1
      ) {
        positionPoints[index] = index === unit.sourceFrom ? before : after;
      }
      widgetSourceEnd = sourceEnd;
      continue;
    }

    if (unit.text === "\n") {
      setMappings(unit.positionBefore, unit.positionBefore, true);
      backgroundRole ??= unit.style.backgroundRole;
      pushRow();
      setMappings(unit.positionBefore + 1, unit.positionAfter, true);
      trailingParagraphRow = true;
      continue;
    }

    setMappings(unit.positionBefore, unit.positionAfter, true);
    trailingParagraphRow = false;
    for (const segment of graphemeSegments(unit.text)) {
      const rendered = printableGrapheme(segment.segment);
      if (rendered === "\t") {
        const tabSize = Math.max(1, options.tabSize ?? 4);
        const spaces = tabSize - (column % tabSize);
        for (let index = 0; index < spaces; index += 1) {
          if (column >= width) pushRow();
          backgroundRole ??= unit.style.backgroundRole;
          cells.push({
            text: " ",
            style: unit.style,
            sourceFrom: unit.sourceFrom,
            sourceTo: unit.sourceTo,
          });
          column += 1;
        }
        continue;
      }
      const cellWidth = Math.max(
        1,
        graphemeCellWidth(rendered, options.ambiguousWidth),
      );
      if (column > 0 && column + cellWidth > width) pushRow();
      backgroundRole ??= unit.style.backgroundRole;
      const selected =
        options.selectionFrom !== undefined &&
        options.selectionTo !== undefined &&
        unit.sourceFrom < options.selectionTo &&
        unit.sourceTo > options.selectionFrom;
      const style = mergeStyles([unit.style, selectionStyle(selected)]);
      cells.push({
        text: rendered,
        style,
        sourceFrom: unit.sourceFrom,
        sourceTo: unit.sourceTo,
      });
      if (cellWidth === 2) {
        cells.push({
          text: "",
          style,
          continuation: true,
          sourceFrom: unit.sourceFrom,
          sourceTo: unit.sourceTo,
        });
      }
      column += cellWidth;
    }
    const after = { row, column };
    for (
      let index = unit.positionBefore + 1;
      index <= unit.positionAfter && index < positionPoints.length;
      index += 1
    ) {
      positionPoints[index] = after;
    }
  }

  if (cells.length > 0 || rows.length === 0 || trailingParagraphRow) {
    rows.push(backgroundRole ? { cells, backgroundRole } : { cells });
  }
  const lastOffset = positionPoints.length - 1;
  if (lastOffset >= 0 && units.length === 0) positionPoints[lastOffset] = { row: 0, column: 0 };
  return { rows, positionPoints, widgetRegions, graphics };
};

export const widgetAtVisualPoint = (
  layout: LayoutResult,
  row: number,
  column: number,
): WidgetLayoutRegion | undefined =>
  layout.widgetRegions.find(
    (region) =>
      region.row === row &&
      column >= region.columnFrom &&
      column < region.columnTo,
  );

export const visualPointForPosition = (
  doc: EditorDocument,
  layout: LayoutResult,
  position: Position,
): { row: number; column: number } =>
  layout.positionPoints[absoluteOffset(doc, position)] ?? { row: 0, column: 0 };

export const positionAtVisualPoint = (
  doc: EditorDocument,
  layout: LayoutResult,
  row: number,
  column: number,
): Position => {
  let closestOffset = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  layout.positionPoints.forEach((point, offset) => {
    const distance = Math.abs(point.row - row) * 10000 + Math.abs(point.column - column);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestOffset = offset;
    }
  });
  return positionFromOffset(doc, closestOffset);
};

export const displayWidth = textCellWidth;

import {
  displayWidth,
  graphemeSegments,
  type Cell,
  type EditorScrollState,
  type FrameRow,
} from "../markdown/index.js";

export interface EditorChromeGeometry {
  readonly contentWidth: number;
  readonly leftPadding: number;
  readonly rightPadding: number;
  readonly leftMargin: number;
  readonly rightMargin: number;
  readonly contentColumn: number;
  readonly scrollbarColumn: number;
  readonly scrollbarWidth: 0 | 1;
}

export interface EditorVerticalGeometry {
  readonly contentHeight: number;
  readonly topPadding: number;
  readonly bottomPadding: number;
}

export interface MenuBarSection {
  readonly label: string;
}

export interface MenuBarSegment {
  readonly from: number;
  readonly to: number;
}

const cellsForText = (
  text: string,
  role: string,
): Cell[] => {
  const cells: Cell[] = [];
  for (const { segment } of graphemeSegments(text)) {
    const width = Math.max(0, displayWidth(segment));
    cells.push({ text: segment, style: { role } });
    for (let index = 1; index < width; index += 1) {
      cells.push({ text: "", style: { role }, continuation: true });
    }
  }
  return cells;
};

const blankCells = (count: number, role: string): Cell[] =>
  Array.from(
    { length: Math.max(0, count) },
    () => ({ text: " ", style: { role } }),
  );

export const editorChromeGeometry = (
  width: number,
  maximumContentWidth = 80,
  showScrollbar = true,
): EditorChromeGeometry => {
  const availableWidth = Math.max(1, width);
  const scrollbarWidth = showScrollbar ? 1 : 0;
  const editorAreaWidth = Math.max(1, availableWidth - scrollbarWidth);
  const surfaceWidth = Math.min(
    maximumContentWidth + 2,
    editorAreaWidth,
  );
  const rightPadding = surfaceWidth >= 2 ? 1 : 0;
  const leftPadding = surfaceWidth >= 3 ? 1 : 0;
  const contentWidth = Math.max(
    1,
    surfaceWidth - leftPadding - rightPadding,
  );
  const remaining = editorAreaWidth - surfaceWidth;
  const leftMargin = Math.floor(remaining / 2);
  return {
    contentWidth,
    leftPadding,
    rightPadding,
    leftMargin,
    rightMargin: remaining - leftMargin,
    contentColumn: leftMargin + leftPadding,
    scrollbarColumn: showScrollbar ? availableWidth - 1 : availableWidth,
    scrollbarWidth,
  };
};

export const editorVerticalGeometry = (
  height: number,
): EditorVerticalGeometry => {
  const availableHeight = Math.max(0, height);
  const bottomPadding = availableHeight >= 2 ? 1 : 0;
  const topPadding = availableHeight >= 3 ? 1 : 0;
  return {
    contentHeight: Math.max(
      0,
      availableHeight - topPadding - bottomPadding,
    ),
    topPadding,
    bottomPadding,
  };
};

export const scrollbarCell = (
  scroll: EditorScrollState,
  row: number,
): Cell => {
  if (scroll.totalRows <= scroll.viewportRows) {
    return { text: " ", style: { role: "flowScrollbarTrack" } };
  }
  const trackRows = Math.max(1, scroll.viewportRows);
  const thumbRows = Math.max(
    1,
    Math.round(trackRows * trackRows / scroll.totalRows),
  );
  const maximumTop = Math.max(1, scroll.totalRows - scroll.viewportRows);
  const thumbTop = Math.round(
    scroll.topRow / maximumTop * Math.max(0, trackRows - thumbRows),
  );
  const inThumb = row >= thumbTop && row < thumbTop + thumbRows;
  return {
    text: inThumb ? "█" : "│",
    style: { role: inThumb ? "flowScrollbarThumb" : "flowScrollbarTrack" },
  };
};

export const editorChromeRow = (
  row: FrameRow,
  width: number,
  geometry: EditorChromeGeometry,
  scrollbar: Cell,
  contentBackgroundRole = "flowEditorBackground",
  marginRole = "flowEditorMargin",
): FrameRow => ({
  cells: [
    ...blankCells(geometry.leftMargin, marginRole),
    ...blankCells(geometry.leftPadding, "flowEditorBackground"),
    ...row.cells.slice(0, geometry.contentWidth),
    ...blankCells(
      Math.max(0, geometry.contentWidth - row.cells.length),
      contentBackgroundRole,
    ),
    ...blankCells(geometry.rightPadding, "flowEditorBackground"),
    ...blankCells(geometry.rightMargin, marginRole),
    ...(geometry.scrollbarWidth === 1 ? [scrollbar] : []),
  ].slice(0, Math.max(1, width)),
});

export const menuBar = (
  sections: readonly MenuBarSection[],
  width: number,
  activeSection: number | null,
): { readonly row: FrameRow; readonly segments: readonly MenuBarSegment[] } => {
  const cells = blankCells(width, "flowMenu");
  const segments: MenuBarSegment[] = [];
  let column = 1;
  sections.forEach((section, index) => {
    const text = ` ${section.label} `;
    const sectionCells = cellsForText(
      text,
      index === activeSection ? "flowMenuActive" : "flowMenu",
    );
    const from = column;
    sectionCells.forEach((cell, offset) => {
      if (column + offset < cells.length) cells[column + offset] = cell;
    });
    column += sectionCells.length;
    segments.push({ from, to: column });
  });
  return { row: { cells }, segments };
};

export const positionedRow = (
  base: FrameRow,
  text: string,
  column: number,
  width: number,
  role: string,
): FrameRow => {
  const cells = [...base.cells.slice(0, width)];
  cellsForText(text, role).forEach((cell, offset) => {
    if (column + offset < cells.length) cells[column + offset] = cell;
  });
  return { ...base, cells };
};

const cropText = (text: string, width: number): string => {
  if (displayWidth(text) <= width) return text;
  if (width <= 0) return "";
  if (width === 1) return "…";
  const segments = graphemeSegments(text).map(({ segment }) => segment);
  while (segments.length > 0 && displayWidth(segments.join("")) >= width) {
    segments.pop();
  }
  return `${segments.join("")}…`;
};

export const statusBar = (
  left: string,
  right: string,
  width: number,
): FrameRow => {
  const rightWidth = Math.min(width, displayWidth(right));
  const leftWidth = Math.max(0, width - rightWidth - (rightWidth > 0 ? 1 : 0));
  const leftText = cropText(left, leftWidth);
  const gap = Math.max(0, width - displayWidth(leftText) - rightWidth);
  return {
    cells: [
      ...cellsForText(leftText, "flowStatus"),
      ...blankCells(gap, "flowStatus"),
      ...cellsForText(cropText(right, rightWidth), "flowStatus"),
    ].slice(0, width),
  };
};

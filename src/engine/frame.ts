import type { TextStyle } from "./decorations.js";
import type { WidgetKey, WidgetPlacement } from "./decorations.js";
import type { Range } from "./model.js";

export interface Cell {
  readonly text: string;
  readonly style: TextStyle;
  readonly continuation?: boolean;
  readonly sourceFrom?: number;
  readonly sourceTo?: number;
}

export interface FrameRow {
  readonly cells: readonly Cell[];
  readonly backgroundRole?: string;
}

export interface FrameCursor {
  readonly row: number;
  readonly column: number;
  readonly visible: boolean;
}

export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly FrameRow[];
  readonly cursor: FrameCursor;
  readonly graphics?: readonly FrameGraphic[];
}

export interface FrameGraphic {
  readonly key: WidgetKey;
  readonly row: number;
  readonly column: number;
  readonly columns: number;
  readonly rows: number;
  readonly image: {
    readonly format: "rgba";
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
  };
}

export interface VisualPoint {
  readonly row: number;
  readonly column: number;
}

export interface LayoutResult {
  readonly rows: readonly FrameRow[];
  readonly positionPoints: readonly VisualPoint[];
  readonly widgetRegions: readonly WidgetLayoutRegion[];
  readonly graphics: readonly FrameGraphic[];
}

export interface WidgetLayoutRegion {
  readonly key: WidgetKey;
  readonly placement: WidgetPlacement;
  readonly range: Range;
  readonly row: number;
  readonly columnFrom: number;
  readonly columnTo: number;
}

export const emptyCell = (): Cell => ({ text: " ", style: {} });

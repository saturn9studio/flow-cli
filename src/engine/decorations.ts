import type { EditorDocument, Position, Range, Selection } from "./model.js";
import type { InputEvent } from "./input.js";
import type { SyntaxSnapshot } from "./syntax.js";
import type { Transaction } from "./transaction.js";

export type NamedTerminalColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

export interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export type TerminalColor = NamedTerminalColor | RgbColor;

export interface TextStyle {
  readonly role?: string;
  readonly backgroundRole?: string;
  readonly foreground?: TerminalColor;
  readonly background?: TerminalColor;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly inverse?: boolean;
}

export interface InlineDecoration {
  readonly kind: "inline";
  readonly from: number;
  readonly to: number;
  readonly style: TextStyle;
}

export interface ConcealDecoration {
  readonly kind: "conceal";
  readonly from: number;
  readonly to: number;
}

export interface ReplaceDecoration {
  readonly kind: "replace";
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly style?: TextStyle;
}

export interface LineDecoration {
  readonly kind: "line";
  readonly from: number;
  readonly to: number;
  readonly backgroundRole: string;
}

export type EditorDecoration =
  | InlineDecoration
  | ConcealDecoration
  | ReplaceDecoration
  | LineDecoration;

export type WidgetKey = `${string}:${string}`;
export type WidgetPlacement = "inline" | "block";
export type WidgetSelectionBehavior = "inline" | "atom" | "block";

export interface WidgetTextRun {
  readonly text: string;
  readonly style?: TextStyle;
}

export interface WidgetGraphic {
  readonly format: "rgba";
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface WidgetRenderContext<TProps> {
  readonly props: TProps;
  readonly sourceText: string;
  readonly width: number;
  readonly readOnly: boolean;
  readonly focused: boolean;
}

export interface WidgetRenderResult {
  /** Inline widgets must return at most one line; block widgets may return many. */
  readonly lines: readonly (string | readonly WidgetTextRun[])[];
  /** Hosts with native graphics support may replace the rendered cell fallback. */
  readonly graphic?: WidgetGraphic;
}

export interface WidgetActionContext<TProps = unknown> {
  readonly key: WidgetKey;
  readonly props: TProps;
  readonly sourceText: string;
  readonly readOnly: boolean;
  readonly focused: boolean;
  dispatch(transaction: Transaction): void;
  replaceSelf(text: string): boolean;
  deleteSelf(): boolean;
  focusEditor(position?: Position): void;
}

export interface WidgetInputContext<TProps = unknown>
  extends WidgetActionContext<TProps> {
  readonly event: InputEvent;
}

export interface WidgetRenderer<TProps = unknown> {
  render(context: WidgetRenderContext<TProps>): WidgetRenderResult;
  handleInput?(context: WidgetInputContext<TProps>): boolean;
}

export interface WidgetDecoration<TProps = unknown> {
  readonly key: WidgetKey;
  readonly placement: WidgetPlacement;
  readonly range: Range;
  readonly props: TProps;
  readonly render: WidgetRenderer<TProps>;
  readonly selection: WidgetSelectionBehavior;
  /** Whether vertical caret movement may hand focus to this block widget. */
  readonly focusable?: boolean;
}

export interface EditorSnapshot {
  readonly doc: EditorDocument;
  readonly selection: Selection;
  readonly content: string;
  readonly readOnly: boolean;
  readonly syntax: SyntaxSnapshot;
}

export interface PositionMapping {
  readonly position: Position;
  readonly affinity: "before" | "after";
}

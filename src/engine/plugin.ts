import type { EditorCommand, EditorKeyBinding } from "./commands.js";
import type {
  EditorDecoration,
  EditorSnapshot,
  WidgetDecoration,
} from "./decorations.js";
import type { InputEvent } from "./input.js";
import type { EditorDocument, Selection } from "./model.js";
import type { Transaction } from "./transaction.js";

export class PluginId<S> {
  readonly state?: S;

  constructor(readonly name: string) {}
}

export interface PluginInitContext extends EditorSnapshot {}

export interface PluginApplyContext<S> extends EditorSnapshot {
  readonly state: S;
  readonly previousDoc: EditorDocument;
  readonly previousSelection: Selection;
  readonly transaction: Transaction;
}

export interface PluginOutputContext<S> extends EditorSnapshot {
  readonly state: S;
}

export interface PluginInputContext<S> extends PluginOutputContext<S> {
  readonly event: InputEvent;
  readonly dispatch: (transaction: Transaction) => void;
}

export interface EditorPlugin<S> {
  readonly id: PluginId<S>;
  init(context: PluginInitContext): S;
  apply(context: PluginApplyContext<S>): S;
  decorations?(context: PluginOutputContext<S>): readonly EditorDecoration[];
  widgets?(context: PluginOutputContext<S>): readonly WidgetDecoration[];
  commands?(context: PluginOutputContext<S>): readonly EditorCommand[];
  handleInput?(context: PluginInputContext<S>): boolean;
  readonly keymap?: readonly EditorKeyBinding[];
  destroy?(context: PluginOutputContext<S>): void;
}

export interface PluginOutput {
  readonly decorations: readonly EditorDecoration[];
  readonly widgets: readonly WidgetDecoration[];
}

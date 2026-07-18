import {
  defaultEditorKeymap,
  editorCommandNames,
  keyBindingMatches,
  type EditorCommand,
  type EditorKeyBinding,
} from "./commands.js";
import type {
  EditorSnapshot,
  WidgetActionContext,
  WidgetDecoration,
  WidgetInputContext,
  WidgetKey,
} from "./decorations.js";
import type { AmbiguousWidth } from "./cellWidth.js";
import type { Frame, FrameRow, LayoutResult } from "./frame.js";
import { EditorHistory, historyEventMetaKey, type HistoryEvent, type HistorySnapshot } from "./history.js";
import type { InputEvent, MouseInputEvent } from "./input.js";
import {
  layoutDocument,
  positionAtVisualPoint,
  visualPointForPosition,
  widgetAtVisualPoint,
} from "./layout.js";
import {
  type EditorDocument,
  type Position,
  type Selection,
  absoluteOffset,
  collapsedSelection,
  documentFromText,
  documentToText,
  firstPosition,
  isSamePosition,
  lastPosition,
  nextPosition,
  nextWordPosition,
  normalizeRange,
  previousPosition,
  previousWordPosition,
  selectionIsCollapsed,
} from "./model.js";
import type { EditorPlugin, PluginId, PluginOutput } from "./plugin.js";
import {
  emptySyntaxProvider,
  type SyntaxProvider,
  type SyntaxSnapshot,
} from "./syntax.js";
import { createTransaction, type Transaction } from "./transaction.js";

interface PluginSlot {
  readonly plugin: EditorPlugin<unknown>;
  state: unknown;
}

interface LayoutCache {
  readonly key: string;
  readonly layout: LayoutResult;
}

interface OutputCache {
  readonly key: string;
  readonly output: PluginOutput;
}

export interface TerminalEditorOptions {
  readonly content?: string;
  readonly readOnly?: boolean;
  readonly plugins?: readonly EditorPlugin<unknown>[];
  readonly syntaxProvider?: SyntaxProvider;
  readonly commands?: readonly EditorCommand[];
  readonly keymap?: readonly EditorKeyBinding[];
  readonly tabSize?: number;
  readonly ambiguousWidth?: AmbiguousWidth;
  readonly onChange?: (snapshot: EditorStateSnapshot) => void;
}

export interface EditorStateSnapshot extends EditorSnapshot {
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface EditorScrollState {
  readonly topRow: number;
  readonly totalRows: number;
  readonly viewportRows: number;
}

export class StaleTransactionError extends Error {
  constructor() {
    super("Transaction was created from stale editor state.");
  }
}

const snapshotForHistory = (
  doc: EditorDocument,
  selection: Selection,
  syntax: SyntaxSnapshot,
): HistorySnapshot => ({
  doc,
  selection,
  syntax,
  content: documentToText(doc),
});

export class TerminalEditor {
  private doc: EditorDocument;
  private selection: Selection;
  private syntax: SyntaxSnapshot;
  private readonly syntaxProvider: SyntaxProvider;
  private plugins: PluginSlot[];
  private readonly history = new EditorHistory();
  private readonly appKeymap: readonly EditorKeyBinding[];
  private readonly tabSize: number;
  private readonly ambiguousWidth: AmbiguousWidth;
  private readonly onChange?: (snapshot: EditorStateSnapshot) => void;
  private revision = 0;
  private desiredColumn: number | null = null;
  private mouseSelecting = false;
  private lastViewport: { readonly width: number; readonly height: number } | undefined;
  private scrollTop = 0;
  private revealCaretPending = true;
  private focusedWidget: WidgetKey | null = null;
  private readOnly: boolean;
  private destroyed = false;
  private presentationRevision = 0;
  private layoutCache: LayoutCache | null = null;
  private outputCache: OutputCache | null = null;
  private readonly updateListeners = new Set<(snapshot: EditorStateSnapshot) => void>();

  constructor(private readonly options: TerminalEditorOptions = {}) {
    this.doc = documentFromText(options.content ?? "");
    this.selection = collapsedSelection(firstPosition());
    this.syntaxProvider = options.syntaxProvider ?? emptySyntaxProvider;
    this.syntax = this.syntaxProvider.create(this.doc);
    this.appKeymap = options.keymap ?? [];
    this.tabSize = options.tabSize ?? 4;
    this.ambiguousWidth = options.ambiguousWidth ?? 1;
    this.onChange = options.onChange;
    this.readOnly = options.readOnly ?? false;
    const initial = this.snapshot();
    this.assertUniquePluginIds(options.plugins ?? []);
    this.plugins = (options.plugins ?? []).map((plugin) => ({
      plugin,
      state: plugin.init(initial),
    }));
  }

  snapshot(): EditorStateSnapshot {
    return {
      doc: this.doc,
      selection: this.selection,
      content: documentToText(this.doc),
      readOnly: this.readOnly,
      syntax: this.syntax,
      revision: this.revision,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
    };
  }

  createTransaction() {
    return createTransaction(this.doc, this.selection);
  }

  dispatch(transaction: Transaction): void {
    if (transaction.docBefore !== this.doc || transaction.selectionBefore !== this.selection) {
      throw new StaleTransactionError();
    }
    const previousDoc = this.doc;
    const previousSelection = this.selection;
    const previousSyntax = this.syntax;
    this.doc = transaction.docAfter;
    this.selection = transaction.selectionAfter;
    this.revealCaretPending = true;
    this.syntax = this.syntaxProvider.update(
      this.syntax,
      this.doc,
      transaction.displayChanges,
    );
    this.revision += 1;
    const next = this.snapshot();
    for (const slot of this.plugins) {
      slot.state = slot.plugin.apply({
        ...next,
        state: slot.state,
        previousDoc,
        previousSelection,
        transaction,
      });
    }
    if (transaction.displayChanges.length > 0) {
      this.history.record(
        {
          before: snapshotForHistory(previousDoc, previousSelection, previousSyntax),
          after: snapshotForHistory(this.doc, this.selection, this.syntax),
        },
        transaction.meta.get(historyEventMetaKey) ?? { kind: "boundary" },
      );
    } else {
      this.history.closeBatch();
    }
    this.notifyUpdate();
  }

  setContent(content: string): void {
    this.doc = documentFromText(content);
    this.selection = collapsedSelection(firstPosition());
    this.syntax = this.syntaxProvider.create(this.doc);
    this.history.reset();
    this.scrollTop = 0;
    this.revealCaretPending = true;
    this.revision += 1;
    this.notifyUpdate();
  }

  setReadOnly(readOnly: boolean): void {
    if (this.readOnly === readOnly) return;
    this.readOnly = readOnly;
    this.revision += 1;
    this.notifyUpdate();
  }

  setPlugins(plugins: readonly EditorPlugin<unknown>[]): void {
    if (this.destroyed) throw new Error("Cannot configure a destroyed TerminalEditor.");
    this.assertUniquePluginIds(plugins);
    const previous = new Map(this.plugins.map((slot) => [slot.plugin.id, slot]));
    const next: PluginSlot[] = [];
    for (const plugin of plugins) {
      const retained = previous.get(plugin.id);
      if (retained) {
        next.push({ plugin, state: retained.state });
        previous.delete(plugin.id);
      } else {
        next.push({ plugin, state: plugin.init(this.snapshot()) });
      }
    }
    const snapshot = this.snapshot();
    for (const slot of previous.values()) {
      slot.plugin.destroy?.({ ...snapshot, state: slot.state });
    }
    this.plugins = next;
    this.presentationRevision += 1;
    this.layoutCache = null;
    this.outputCache = null;
    this.notifyUpdate();
  }

  invalidatePresentation(): void {
    if (this.destroyed) return;
    this.presentationRevision += 1;
    this.layoutCache = null;
    this.outputCache = null;
    this.notifyUpdate();
  }

  onUpdate(listener: (snapshot: EditorStateSnapshot) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  getPluginState<S>(id: PluginId<S>): S | undefined {
    return this.plugins.find((slot) => slot.plugin.id === id)?.state as S | undefined;
  }

  output(): PluginOutput {
    const key = `${this.revision}:${this.presentationRevision}`;
    if (this.outputCache?.key === key) return this.outputCache.output;
    const snapshot = this.snapshot();
    const output = {
      decorations: this.plugins.flatMap((slot) =>
        slot.plugin.decorations?.({ ...snapshot, state: slot.state }) ?? [],
      ),
      widgets: this.plugins.flatMap((slot) =>
        slot.plugin.widgets?.({ ...snapshot, state: slot.state }) ?? [],
      ),
    };
    this.outputCache = { key, output };
    return output;
  }

  handleInput(event: InputEvent, viewport?: { width: number; height: number }): boolean {
    if (event.kind === "key" && event.action === "release") return false;
    if (event.kind === "key") {
      if (this.runKeymap(this.appKeymap, event, viewport)) return true;
    }
    if (event.kind !== "mouse" && this.handleFocusedWidgetInput(event)) {
      return true;
    }
    if (event.kind === "key") {
      for (const slot of this.plugins) {
        if (this.runKeymap(slot.plugin.keymap ?? [], event, viewport)) return true;
      }
    }

    if (
      this.focusedWidget &&
      (event.kind === "text" || event.kind === "paste")
    ) {
      return true;
    }

    for (const slot of this.plugins) {
      if (
        slot.plugin.handleInput?.({
          ...this.snapshot(),
          state: slot.state,
          event,
          dispatch: (transaction) => this.dispatch(transaction),
        })
      ) {
        return true;
      }
    }

    if (event.kind === "text" || event.kind === "paste") {
      if (this.readOnly) return true;
      const eventMeta: HistoryEvent = event.kind === "text"
        ? { kind: "typing", text: event.text }
        : { kind: "boundary" };
      this.dispatch(
        this.createTransaction()
          .replaceSelection(event.text.replace(/\r\n?/gu, "\n"))
          .setMeta(historyEventMetaKey, eventMeta)
          .build(),
      );
      this.desiredColumn = null;
      return true;
    }

    if (event.kind === "mouse") {
      return this.handleMouse(event, viewport);
    }

    if (event.kind === "resize") return false;
    if (event.kind === "key" && event.key === "Tab") {
      return this.focusAdjacentWidget(event.shift ? -1 : 1);
    }
    if (event.kind === "key" && this.focusedWidget) return true;
    return this.runKeymap(defaultEditorKeymap, event, viewport);
  }

  execute(commandName: string, viewport?: { width: number; height: number }): boolean {
    for (const command of [
      ...(this.options.commands ?? []),
      ...this.pluginCommands(),
    ]) {
      if (command.name !== commandName) continue;
      if (command.run({
        ...this.snapshot(),
        dispatch: (transaction) => this.dispatch(transaction),
        execute: (name) => this.execute(name, viewport),
      })) return true;
    }

    switch (commandName) {
      case editorCommandNames.undo:
        return this.restoreHistory("undo");
      case editorCommandNames.redo:
        return this.restoreHistory("redo");
      case editorCommandNames.selectAll:
        this.setFocusedWidget(null);
        return this.moveToSelection({
          anchor: firstPosition(),
          head: lastPosition(this.doc),
        });
      case editorCommandNames.moveDocumentStart:
        return this.moveTo(firstPosition(), false);
      case editorCommandNames.moveDocumentStartExtend:
        return this.moveTo(firstPosition(), true);
      case editorCommandNames.moveDocumentEnd:
        return this.moveTo(lastPosition(this.doc), false);
      case editorCommandNames.moveDocumentEndExtend:
        return this.moveTo(lastPosition(this.doc), true);
      case editorCommandNames.moveLeft:
        return this.moveHorizontal("left", false);
      case editorCommandNames.moveLeftExtend:
        return this.moveHorizontal("left", true);
      case editorCommandNames.moveRight:
        return this.moveHorizontal("right", false);
      case editorCommandNames.moveRightExtend:
        return this.moveHorizontal("right", true);
      case editorCommandNames.moveWordLeft:
        return this.moveWord("left", false);
      case editorCommandNames.moveWordLeftExtend:
        return this.moveWord("left", true);
      case editorCommandNames.moveWordRight:
        return this.moveWord("right", false);
      case editorCommandNames.moveWordRightExtend:
        return this.moveWord("right", true);
      case editorCommandNames.moveUp:
        return this.moveVertical(-1, false, viewport);
      case editorCommandNames.moveUpExtend:
        return this.moveVertical(-1, true, viewport);
      case editorCommandNames.moveDown:
        return this.moveVertical(1, false, viewport);
      case editorCommandNames.moveDownExtend:
        return this.moveVertical(1, true, viewport);
      case editorCommandNames.moveLineStart:
        return this.moveLineBoundary("start", false, viewport);
      case editorCommandNames.moveLineStartExtend:
        return this.moveLineBoundary("start", true, viewport);
      case editorCommandNames.moveLineEnd:
        return this.moveLineBoundary("end", false, viewport);
      case editorCommandNames.moveLineEndExtend:
        return this.moveLineBoundary("end", true, viewport);
      case editorCommandNames.deleteBackward:
        return this.deleteBackward();
      case editorCommandNames.deleteForward:
        return this.deleteForward();
      case editorCommandNames.deleteWordBackward:
        return this.deleteWord("backward");
      case editorCommandNames.deleteWordForward:
        return this.deleteWord("forward");
      case editorCommandNames.insertLineBreak:
        return this.insertBoundary("\n");
      default:
        return false;
    }
  }

  frame(width: number, height: number): Frame {
    const availableWidth = Math.max(1, width);
    const availableHeight = Math.max(1, height);
    this.lastViewport = { width: availableWidth, height: availableHeight };
    const range = normalizeRange(this.selection);
    const layout = this.createLayout(availableWidth, {
      selectionFrom: selectionIsCollapsed(this.selection)
        ? undefined
        : absoluteOffset(this.doc, range.from),
      selectionTo: selectionIsCollapsed(this.selection)
        ? undefined
        : absoluteOffset(this.doc, range.to),
    });
    const caret = visualPointForPosition(this.doc, layout, this.selection.head);
    this.updateScrollTop(layout.rows.length, availableHeight, caret.row);
    const rows: FrameRow[] = layout.rows
      .slice(this.scrollTop, this.scrollTop + availableHeight)
      .map((row) => ({
        ...row,
        cells: row.cells.slice(0, availableWidth),
      }));
    while (rows.length < availableHeight) rows.push({ cells: [] });
    const cursorRow = caret.row - this.scrollTop;
    const graphics = layout.graphics
      .filter(
        (graphic) =>
          graphic.row >= this.scrollTop &&
          graphic.row + graphic.rows <= this.scrollTop + availableHeight,
      )
      .map((graphic) => ({ ...graphic, row: graphic.row - this.scrollTop }));
    return {
      width: availableWidth,
      height: availableHeight,
      rows,
      graphics,
      cursor: {
        row: Math.max(0, Math.min(availableHeight - 1, cursorRow)),
        column: Math.min(Math.max(0, availableWidth - 1), caret.column),
        visible:
          !this.readOnly &&
          this.focusedWidget === null &&
          cursorRow >= 0 &&
          cursorRow < availableHeight,
      },
    };
  }

  scrollBy(
    rows: number,
    viewport?: { readonly width: number; readonly height: number },
  ): boolean {
    const resolved = this.resolveViewport(viewport);
    const layout = this.createLayout(resolved.width);
    return this.setScrollTop(this.scrollTop + rows, layout.rows.length, resolved.height);
  }

  scrollToRow(
    row: number,
    viewport?: { readonly width: number; readonly height: number },
  ): boolean {
    const resolved = this.resolveViewport(viewport);
    const layout = this.createLayout(resolved.width);
    return this.setScrollTop(row, layout.rows.length, resolved.height);
  }

  scrollToFraction(
    fraction: number,
    viewport?: { readonly width: number; readonly height: number },
  ): boolean {
    const resolved = this.resolveViewport(viewport);
    const layout = this.createLayout(resolved.width);
    const maximum = Math.max(0, layout.rows.length - resolved.height);
    return this.setScrollTop(
      Math.round(Math.max(0, Math.min(1, fraction)) * maximum),
      layout.rows.length,
      resolved.height,
    );
  }

  scrollState(
    viewport?: { readonly width: number; readonly height: number },
  ): EditorScrollState {
    const resolved = this.resolveViewport(viewport);
    const layout = this.createLayout(resolved.width);
    this.scrollTop = this.clampScrollTop(
      this.scrollTop,
      layout.rows.length,
      resolved.height,
    );
    return {
      topRow: this.scrollTop,
      totalRows: layout.rows.length,
      viewportRows: resolved.height,
    };
  }

  get focusedWidgetKey(): WidgetKey | null {
    return this.focusedWidget;
  }

  focusWidget(key: WidgetKey): boolean {
    const widget = this.widgetByKey(key);
    if (!widget?.render.handleInput) return false;
    this.moveTo(widget.range.from, false);
    this.setFocusedWidget(key);
    this.revealCaretPending = true;
    return true;
  }

  focusEditor(position?: Position): void {
    const widget = this.focusedWidget ? this.widgetByKey(this.focusedWidget) : undefined;
    this.setFocusedWidget(null);
    const target = position ?? widget?.range.to;
    if (target) this.moveTo(target, false);
    this.revealCaretPending = true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const snapshot = this.snapshot();
    for (const slot of this.plugins) {
      slot.plugin.destroy?.({ ...snapshot, state: slot.state });
    }
  }

  private pluginCommands(): readonly EditorCommand[] {
    const snapshot = this.snapshot();
    return this.plugins.flatMap((slot) =>
      slot.plugin.commands?.({ ...snapshot, state: slot.state }) ?? [],
    );
  }

  private runKeymap(
    keymap: readonly EditorKeyBinding[],
    event: InputEvent,
    viewport?: { width: number; height: number },
  ): boolean {
    for (const binding of keymap) {
      if (keyBindingMatches(event, binding) && this.execute(binding.command, viewport)) {
        return true;
      }
    }
    return false;
  }

  private createLayout(
    width: number,
    selection: { readonly selectionFrom?: number; readonly selectionTo?: number } = {},
  ) {
    const cacheKey = this.layoutCacheKey(width, selection);
    if (this.layoutCache?.key === cacheKey) return this.layoutCache.layout;
    const output = this.output();
    if (
      this.focusedWidget &&
      !output.widgets.some((widget) => widget.key === this.focusedWidget)
    ) {
      this.setFocusedWidget(null);
    }
    const layout = layoutDocument(this.doc, {
      width: Math.max(1, width),
      tabSize: this.tabSize,
      readOnly: this.readOnly,
      decorations: output.decorations,
      widgets: output.widgets,
      focusedWidgetKey: this.focusedWidget ?? undefined,
      ambiguousWidth: this.ambiguousWidth,
      ...selection,
    });
    this.layoutCache = {
      key: this.layoutCacheKey(width, selection),
      layout,
    };
    return layout;
  }

  private layoutCacheKey(
    width: number,
    selection: { readonly selectionFrom?: number; readonly selectionTo?: number },
  ): string {
    return [
      this.revision,
      this.presentationRevision,
      Math.max(1, width),
      selection.selectionFrom ?? "",
      selection.selectionTo ?? "",
      this.focusedWidget ?? "",
      this.readOnly ? 1 : 0,
      this.ambiguousWidth,
    ].join(":");
  }

  private resolveViewport(
    viewport?: { readonly width: number; readonly height: number },
  ): { readonly width: number; readonly height: number } {
    return {
      width: Math.max(1, viewport?.width ?? this.lastViewport?.width ?? 80),
      height: Math.max(1, viewport?.height ?? this.lastViewport?.height ?? 24),
    };
  }

  private setScrollTop(top: number, totalRows: number, height: number): boolean {
    const next = this.clampScrollTop(top, totalRows, height);
    this.revealCaretPending = false;
    if (next === this.scrollTop) return false;
    this.scrollTop = next;
    return true;
  }

  private clampScrollTop(top: number, totalRows: number, height: number): number {
    return Math.max(
      0,
      Math.min(Math.trunc(top), Math.max(0, totalRows - height)),
    );
  }

  private updateScrollTop(totalRows: number, height: number, caretRow: number): void {
    const maximum = Math.max(0, totalRows - height);
    if (this.revealCaretPending) {
      if (caretRow < this.scrollTop) this.scrollTop = caretRow;
      if (caretRow >= this.scrollTop + height) this.scrollTop = caretRow - height + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maximum));
    this.revealCaretPending = false;
  }

  private handleMouse(
    event: MouseInputEvent,
    viewport?: { width: number; height: number },
  ): boolean {
    if (event.action !== "press" && this.focusedWidget) {
      const focused = this.widgetByKey(this.focusedWidget);
      if (
        focused?.render.handleInput?.(this.widgetInputContext(focused, event))
      ) {
        return true;
      }
    }
    if (event.action === "wheel") {
      if (event.button === "wheelUp") {
        this.scrollBy(-3, viewport);
        return true;
      }
      if (event.button === "wheelDown") {
        this.scrollBy(3, viewport);
        return true;
      }
      return false;
    }
    if (event.action === "press") {
      this.mouseSelecting = false;
      if (event.button !== "left") return false;
      const widget = this.widgetForMouse(event, viewport);
      if (widget?.render.handleInput) {
        this.focusWidget(widget.key);
        widget.render.handleInput(this.widgetInputContext(widget, event));
        return true;
      }
      this.setFocusedWidget(null);
      this.mouseSelecting = true;
      this.moveTo(this.positionForMouse(event, viewport), event.shift ?? false);
      return true;
    }
    if (event.action === "move" && this.mouseSelecting && event.button === "left") {
      const resolved = this.resolveViewport(viewport);
      if (event.row <= 0) this.scrollBy(-1, resolved);
      if (event.row >= resolved.height - 1) this.scrollBy(1, resolved);
      this.moveTo(this.positionForMouse(event, viewport), true);
      return true;
    }
    if (event.action === "release" && this.mouseSelecting) {
      this.mouseSelecting = false;
      if (event.button === "left") {
        this.moveTo(this.positionForMouse(event, viewport), true);
      }
      return true;
    }
    return false;
  }

  private positionForMouse(
    event: MouseInputEvent,
    viewport?: { width: number; height: number },
  ): Position {
    const resolved = this.resolveViewport(viewport);
    const layout = this.createLayout(resolved.width);
    const caret = visualPointForPosition(this.doc, layout, this.selection.head);
    this.updateScrollTop(layout.rows.length, resolved.height, caret.row);
    this.desiredColumn = null;
    return positionAtVisualPoint(
      this.doc,
      layout,
      Math.max(0, event.row) + this.scrollTop,
      Math.max(0, event.column),
    );
  }

  private widgetForMouse(
    event: MouseInputEvent,
    viewport?: { width: number; height: number },
  ): WidgetDecoration | undefined {
    const resolved = this.resolveViewport(viewport);
    const layout = this.createLayout(resolved.width);
    const caret = visualPointForPosition(this.doc, layout, this.selection.head);
    this.updateScrollTop(layout.rows.length, resolved.height, caret.row);
    const region = widgetAtVisualPoint(
      layout,
      Math.max(0, event.row) + this.scrollTop,
      Math.max(0, event.column),
    );
    return region ? this.widgetByKey(region.key) : undefined;
  }

  private widgetByKey(key: WidgetKey): WidgetDecoration | undefined {
    return this.output().widgets.find((widget) => widget.key === key);
  }

  private widgetActionContext(
    widget: WidgetDecoration,
  ): WidgetActionContext {
    const sourceText = documentToText(this.doc).slice(
      absoluteOffset(this.doc, widget.range.from),
      absoluteOffset(this.doc, widget.range.to),
    );
    return {
      key: widget.key,
      props: widget.props,
      sourceText,
      readOnly: this.readOnly,
      focused: this.focusedWidget === widget.key,
      dispatch: (transaction) => this.dispatch(transaction),
      replaceSelf: (text) => this.replaceWidget(widget, text),
      deleteSelf: () => this.replaceWidget(widget, ""),
      focusEditor: (position) => this.focusEditor(position ?? widget.range.to),
    };
  }

  private widgetInputContext(
    widget: WidgetDecoration,
    event: InputEvent,
  ): WidgetInputContext {
    return { ...this.widgetActionContext(widget), event };
  }

  private replaceWidget(widget: WidgetDecoration, text: string): boolean {
    if (this.readOnly) return false;
    const current = this.widgetByKey(widget.key) ?? widget;
    this.setFocusedWidget(null);
    this.dispatch(
      this.createTransaction()
        .replaceRange(current.range.from, current.range.to, text)
        .setMeta(historyEventMetaKey, { kind: "boundary" })
        .build(),
    );
    return true;
  }

  private handleFocusedWidgetInput(event: InputEvent): boolean {
    if (!this.focusedWidget) return false;
    const widget = this.widgetByKey(this.focusedWidget);
    if (!widget?.render.handleInput) {
      this.setFocusedWidget(null);
      return false;
    }
    if (widget.render.handleInput(this.widgetInputContext(widget, event))) return true;
    if (event.kind !== "key") return false;
    if (event.key === "Escape") {
      this.focusEditor();
      return true;
    }
    if (event.key === "Tab") return this.focusAdjacentWidget(event.shift ? -1 : 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      this.focusEditor(this.positionOutsideBlockWidget(widget, -1));
      return true;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      this.focusEditor(this.positionOutsideBlockWidget(widget, 1));
      return true;
    }
    return false;
  }

  private focusAdjacentWidget(direction: -1 | 1): boolean {
    const widgets = this.output().widgets
      .filter((widget) => Boolean(widget.render.handleInput))
      .sort(
        (a, b) =>
          absoluteOffset(this.doc, a.range.from) -
          absoluteOffset(this.doc, b.range.from),
      );
    if (widgets.length === 0) return false;
    if (!this.focusedWidget) {
      return this.focusWidget(direction > 0 ? widgets[0].key : widgets.at(-1)!.key);
    }
    const current = widgets.findIndex((widget) => widget.key === this.focusedWidget);
    const next = current + direction;
    if (next < 0 || next >= widgets.length) {
      const widget = widgets[Math.max(0, current)];
      this.focusEditor(direction > 0 ? widget?.range.to : widget?.range.from);
      return true;
    }
    return this.focusWidget(widgets[next].key);
  }

  private restoreHistory(direction: "undo" | "redo"): boolean {
    const restore = direction === "undo" ? this.history.undo() : this.history.redo();
    if (!restore) return false;
    const previousDoc = this.doc;
    const previousSelection = this.selection;
    this.doc = restore.snapshot.doc;
    this.selection = restore.snapshot.selection;
    this.syntax = restore.snapshot.syntax;
    this.revealCaretPending = true;
    this.revision += 1;
    const next = this.snapshot();
    for (const slot of this.plugins) {
      slot.state = slot.plugin.apply({
        ...next,
        state: slot.state,
        previousDoc,
        previousSelection,
        transaction: restore.transaction,
      });
    }
    this.notifyUpdate();
    return true;
  }

  private moveHorizontal(direction: "left" | "right", extend: boolean): boolean {
    const range = normalizeRange(this.selection);
    const target = !extend && !selectionIsCollapsed(this.selection)
      ? direction === "left" ? range.from : range.to
      : direction === "left"
        ? previousPosition(this.doc, this.selection.head)
        : nextPosition(this.doc, this.selection.head);
    this.desiredColumn = null;
    return this.moveTo(target, extend);
  }

  private moveWord(direction: "left" | "right", extend: boolean): boolean {
    const range = normalizeRange(this.selection);
    const target = !extend && !selectionIsCollapsed(this.selection)
      ? direction === "left" ? range.from : range.to
      : direction === "left"
        ? previousWordPosition(this.doc, this.selection.head)
        : nextWordPosition(this.doc, this.selection.head);
    this.desiredColumn = null;
    return this.moveTo(target, extend);
  }

  private moveVertical(
    delta: number,
    extend: boolean,
    viewport?: { width: number; height: number },
  ): boolean {
    const range = normalizeRange(this.selection);
    if (!extend && !selectionIsCollapsed(this.selection)) {
      this.desiredColumn = null;
      return this.moveTo(delta < 0 ? range.from : range.to, false);
    }
    const width = viewport?.width ?? this.lastViewport?.width ?? 80;
    const layout = this.createLayout(width);
    const current = visualPointForPosition(this.doc, layout, this.selection.head);
    this.desiredColumn ??= current.column;
    const targetRow = Math.max(0, current.row + delta);
    const widgetRegion = layout.widgetRegions.find(
      (region) => region.placement === "block" && region.row === targetRow,
    );
    if (widgetRegion) {
      const widget = this.widgetByKey(widgetRegion.key);
      if (!extend && widget?.focusable && widget.render.handleInput) {
        return this.focusWidget(widget.key);
      }
      if (widget) {
        return this.moveTo(this.positionOutsideBlockWidget(widget, delta), extend);
      }
    }
    const target = positionAtVisualPoint(
      this.doc,
      layout,
      targetRow,
      this.desiredColumn,
    );
    return this.moveTo(this.visibleVerticalTarget(target, delta), extend);
  }

  private visibleVerticalTarget(
    target: Position,
    direction: number,
  ): Position {
    const offset = absoluteOffset(this.doc, target);
    const widget = this.output().widgets.find((candidate) => {
      if (
        candidate.placement !== "block" ||
        candidate.selection === "inline" ||
        candidate.focusable
      ) {
        return false;
      }
      const from = absoluteOffset(this.doc, candidate.range.from);
      const to = absoluteOffset(this.doc, candidate.range.to);
      return offset >= from && offset <= to;
    });
    return widget ? this.positionOutsideBlockWidget(widget, direction) : target;
  }

  private positionOutsideBlockWidget(
    widget: WidgetDecoration,
    direction: number,
  ): Position {
    const range = widget.range;
    if (direction > 0) {
      const paragraph = this.doc.paragraphs[range.to.paragraph];
      if (
        range.to.offset >= (paragraph?.text.length ?? 0) &&
        range.to.paragraph + 1 < this.doc.paragraphs.length
      ) {
        return { paragraph: range.to.paragraph + 1, offset: 0 };
      }
      return range.to;
    }
    if (range.from.offset === 0 && range.from.paragraph > 0) {
      const paragraph = range.from.paragraph - 1;
      return {
        paragraph,
        offset: this.doc.paragraphs[paragraph]?.text.length ?? 0,
      };
    }
    return range.from;
  }

  private moveTo(target: Position, extend: boolean): boolean {
    this.setFocusedWidget(null);
    const selection = extend
      ? { anchor: this.selection.anchor, head: target }
      : collapsedSelection(target);
    return this.moveToSelection(selection);
  }

  private moveToSelection(selection: Selection): boolean {
    if (isSamePosition(selection.anchor, this.selection.anchor) &&
        isSamePosition(selection.head, this.selection.head)) return false;
    this.dispatch(this.createTransaction().setSelection(selection).build());
    return true;
  }

  private moveLineBoundary(
    boundary: "start" | "end",
    extend: boolean,
    viewport?: { width: number; height: number },
  ): boolean {
    const width = viewport?.width ?? this.lastViewport?.width ?? 80;
    const layout = this.createLayout(width);
    const current = visualPointForPosition(this.doc, layout, this.selection.head);
    const target = positionAtVisualPoint(
      this.doc,
      layout,
      current.row,
      boundary === "start" ? 0 : Number.MAX_SAFE_INTEGER,
    );
    this.desiredColumn = null;
    return this.moveTo(target, extend);
  }

  private deleteBackward(): boolean {
    if (this.readOnly) return true;
    if (!selectionIsCollapsed(this.selection)) return this.deleteSelection("deleteBackward");
    const from = previousPosition(this.doc, this.selection.head);
    if (isSamePosition(from, this.selection.head)) return false;
    this.dispatch(
      this.createTransaction()
        .replaceRange(from, this.selection.head, "")
        .setMeta(historyEventMetaKey, { kind: "deleteBackward" })
        .build(),
    );
    return true;
  }

  private deleteForward(): boolean {
    if (this.readOnly) return true;
    if (!selectionIsCollapsed(this.selection)) return this.deleteSelection("deleteForward");
    const to = nextPosition(this.doc, this.selection.head);
    if (isSamePosition(to, this.selection.head)) return false;
    this.dispatch(
      this.createTransaction()
        .replaceRange(this.selection.head, to, "")
        .setMeta(historyEventMetaKey, { kind: "deleteForward" })
        .build(),
    );
    return true;
  }

  private deleteWord(direction: "backward" | "forward"): boolean {
    if (this.readOnly) return true;
    if (!selectionIsCollapsed(this.selection)) {
      return this.deleteSelection(
        direction === "backward" ? "deleteBackward" : "deleteForward",
      );
    }
    const target = direction === "backward"
      ? previousWordPosition(this.doc, this.selection.head)
      : nextWordPosition(this.doc, this.selection.head);
    if (isSamePosition(target, this.selection.head)) return false;
    const from = direction === "backward" ? target : this.selection.head;
    const to = direction === "backward" ? this.selection.head : target;
    this.dispatch(
      this.createTransaction()
        .replaceRange(from, to, "")
        .setMeta(historyEventMetaKey, {
          kind: direction === "backward" ? "deleteBackward" : "deleteForward",
        })
        .build(),
    );
    return true;
  }

  private deleteSelection(kind: "deleteBackward" | "deleteForward"): boolean {
    const range = normalizeRange(this.selection);
    this.dispatch(
      this.createTransaction()
        .replaceRange(range.from, range.to, "")
        .setMeta(historyEventMetaKey, { kind })
        .build(),
    );
    return true;
  }

  private insertBoundary(text: string): boolean {
    if (this.readOnly) return true;
    this.dispatch(
      this.createTransaction()
        .replaceSelection(text)
        .setMeta(historyEventMetaKey, { kind: "boundary" })
        .build(),
    );
    return true;
  }

  private assertUniquePluginIds(plugins: readonly EditorPlugin<unknown>[]): void {
    const ids = new Set<object>();
    for (const plugin of plugins) {
      if (ids.has(plugin.id)) {
        throw new Error(`Duplicate plugin id "${plugin.id.name}".`);
      }
      ids.add(plugin.id);
    }
  }

  private setFocusedWidget(key: WidgetKey | null): void {
    if (this.focusedWidget === key) return;
    this.focusedWidget = key;
    this.presentationRevision += 1;
    this.layoutCache = null;
    this.notifyUpdate();
  }

  private notifyUpdate(): void {
    const snapshot = this.snapshot();
    this.onChange?.(snapshot);
    this.updateListeners.forEach((listener) => listener(snapshot));
  }
}

import {
  boot,
  editorCommandNames,
  ImageController,
  keyBindingMatches,
  markdownToPlainText,
  normalizeRange,
  displayWidth,
  graphemeSegments,
  flowCommandNames,
  terminalImageWidgetRenderer,
  textInRange,
  renderMarkdownToHtml,
  type Cell,
  type CommandData,
  type Frame,
  type FrameRow,
  type InputEvent,
  type MarkdownPresentationMode,
  type RgbColor,
  type FlowCliEditor,
  type TerminalImageWidgetProps,
  type WidgetRenderer,
  type WordCount,
} from "../markdown/index.js";
import { decodeTerminalImage } from "../markdown/image-node.js";
import type { TerminalSurface } from "../engine/node.js";
import {
  editorChromeGeometry,
  editorChromeRow,
  editorVerticalGeometry,
  menuBar,
  positionedRow,
  scrollbarCell,
  statusBar,
  type EditorChromeGeometry,
  type MenuBarSegment,
} from "./chrome.js";
import {
  DocumentSession,
  ExternalDocumentChangeError,
  openDocumentSession,
} from "./documents/session.js";
import type {
  DirectoryEntry,
  FlowCliPlatform,
  RecoverySnapshot,
} from "./platform/types.js";
import type { FlowCliSettings } from "./settings.js";
import {
  flowCliThemeOptions,
  flowCliThemes,
} from "./theme.js";

type Mode = MarkdownPresentationMode;

const statusModeItems = [
  { key: "F2", label: "Focus", mode: "focus" },
  { key: "F3", label: "Edit", mode: "edit" },
  { key: "F4", label: "Read", mode: "read" },
  { key: "F5", label: "Source", mode: "source" },
] as const;

const cursorShapeOptions = [
  { id: "block", label: "Block" },
  { id: "underline", label: "Underline" },
  { id: "bar", label: "Bar" },
] as const;
const cursorShapeSettingIndex = 0;
const cursorBlinkingSettingIndex = 1;
const editorSettingsItemCount = 2;
const flowCliWebsite = "https://saturn9.studio/";

export const createFlowCliImageRenderer = (
  background: () => RgbColor | undefined,
): WidgetRenderer<TerminalImageWidgetProps> => ({
  render(context) {
    return terminalImageWidgetRenderer.render({
      ...context,
      props: {
        ...context.props,
        background: background(),
      },
    });
  },
});

const expandInactiveHorizontalRule = (
  row: FrameRow,
  width: number,
): FrameRow => {
  const style = row.cells[0]?.style;
  if (
    !style ||
    row.cells.some((cell) => cell.style.role !== "markdownSeparator")
  ) {
    return row;
  }
  return {
    ...row,
    cells: Array.from(
      { length: width },
      (_value, index): Cell =>
        row.cells[index] ?? { text: "─", style },
    ),
  };
};

type Overlay =
  | { readonly kind: "exit" }
  | { readonly kind: "conflict" }
  | { kind: "palette"; query: string; selected: number }
  | { kind: "find"; query: string }
  | { kind: "replaceSearch"; query: string }
  | { kind: "replaceWith"; search: string; replacement: string }
  | {
      kind: "link";
      text: string;
      url: string;
      contextualTarget?: string;
    }
  | {
      kind: "imageSource";
      source: string;
      alt: string;
      contextualTarget?: string;
    }
  | {
      kind: "imageAlt";
      source: string;
      alt: string;
      contextualTarget?: string;
    }
  | { kind: "export"; format: "html" | "text"; path: string }
  | {
      kind: "fileBrowser";
      directory: string;
      entries: readonly DirectoryEntry[];
      selected: number;
      loading: boolean;
      error?: string;
      request: number;
    }
  | { kind: "documentPath"; path: string }
  | {
      kind: "settings";
      section: "themes" | "editor";
      themeSelected: number;
      editorSelected: number;
      readonly originalSettings: FlowCliSettings;
    }
  | { readonly kind: "recovery"; readonly snapshot: RecoverySnapshot }
  | { readonly kind: "about" }
  | { readonly kind: "help" };

interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly accelerator?: string;
  readonly enabled: boolean;
  readonly checked?: boolean;
  readonly run: () => void;
}

interface MenuSection {
  readonly label: string;
  readonly itemIds: readonly (string | null)[];
}

interface MenuState {
  section: number;
  item: number;
}

interface EditorShell {
  readonly editorTop: number;
  readonly editorHeight: number;
  readonly contentHeight: number;
  readonly topPadding: number;
  readonly bottomPadding: number;
  readonly geometry: EditorChromeGeometry;
}

interface MenuBox {
  readonly entries: readonly (PaletteItem | null)[];
  readonly start: number;
  readonly width: number;
  readonly firstItem: number;
  readonly visibleItems: number;
}

interface OverlayFrame {
  readonly rows: readonly { readonly cells: readonly Cell[] }[];
  readonly cursor?: { readonly row: number; readonly column: number };
}

interface FileBrowserGrid {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly capacity: number;
  readonly start: number;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const rowCells = (
  text: string,
  width: number,
  role: string,
): readonly Cell[] => {
  const cells: Cell[] = [];
  let used = 0;
  for (const { segment } of graphemeSegments(text)) {
    const segmentWidth = Math.max(0, displayWidth(segment));
    if (used + segmentWidth > width) break;
    cells.push({ text: segment, style: { role } });
    for (let index = 1; index < segmentWidth; index += 1) {
      cells.push({ text: "", style: { role }, continuation: true });
    }
    used += segmentWidth;
  }
  while (cells.length < width) cells.push({ text: " ", style: { role } });
  return cells;
};

const removeLastGrapheme = (text: string): string => {
  const segments = graphemeSegments(text);
  const last = segments.at(-1);
  return last ? text.slice(0, last.index) : "";
};

const singleLine = (text: string): string => text.replace(/[\r\n]+/gu, " ");

const hasPrimaryModifier = (
  event: Extract<InputEvent, { kind: "key" }>,
): boolean => Boolean(event.ctrl || event.meta);

const menuSections: readonly MenuSection[] = [
  {
    label: "File",
    itemIds: [
      "flow.new",
      "flow.open",
      "flow.saveAs",
      null,
      "flow.export.html",
      "flow.export.text",
      null,
      "flow.settings",
      null,
      "flow.exit",
    ],
  },
  {
    label: "Edit",
    itemIds: [
      flowCommandNames.undo,
      flowCommandNames.redo,
      null,
      "flow.cut",
      "flow.copy",
      "flow.paste",
      null,
      flowCommandNames.selectAll,
      null,
      "flow.find",
      "flow.replace",
    ],
  },
  {
    label: "View",
    itemIds: [
      "flow.mode.focus",
      "flow.mode.edit",
      "flow.mode.read",
      "flow.mode.source",
    ],
  },
  {
    label: "Insert",
    itemIds: [
      flowCommandNames.blockquote,
      "flow.link",
      "flow.image",
      flowCommandNames.table,
      flowCommandNames.codeBlock,
      flowCommandNames.mathBlock,
      flowCommandNames.horizontalRule,
    ],
  },
  {
    label: "Format",
    itemIds: [
      flowCommandNames.heading1,
      flowCommandNames.heading2,
      flowCommandNames.heading3,
      flowCommandNames.heading4,
      flowCommandNames.heading5,
      flowCommandNames.heading6,
      null,
      flowCommandNames.bold,
      flowCommandNames.italic,
      flowCommandNames.underline,
      flowCommandNames.strikethrough,
      flowCommandNames.highlight,
      flowCommandNames.code,
      flowCommandNames.math,
      null,
      flowCommandNames.bulletList,
      flowCommandNames.orderedList,
    ],
  },
  {
    label: "Help",
    itemIds: ["flow.help", null, "flow.about"],
  },
];

export class FlowCliApp implements TerminalSurface {
  private readonly scribe: FlowCliEditor;
  private readonly imageController: ImageController;
  private readonly listeners = new Set<() => void>();
  private wordCount = 0;
  private wordCountIsSelection = false;
  private overlay: Overlay | null = null;
  private menu: MenuState | null = null;
  private contextualEditRequested = false;
  private contextualEditSuppressed: string | null = null;
  private scrollbarDragging = false;
  private mode: Mode;
  private message = "";
  private saving = false;
  private settingsSaving = false;
  private exitAfterSave = false;
  private exitHandler: () => void = () => {};
  private pendingOperation: Promise<void> = Promise.resolve();
  private destroyed = false;
  private recoveryTimer: unknown | null = null;
  private autosaveTimer: unknown | null = null;
  private currentDocument: DocumentSession;

  constructor(
    document: DocumentSession,
    private readonly platform: FlowCliPlatform,
    private settings: FlowCliSettings,
    recovery: RecoverySnapshot | null = null,
  ) {
    this.currentDocument = document;
    this.mode = "edit";
    this.imageController = new ImageController(async ({ src }) =>
      decodeTerminalImage(
        await this.platform.assets.readImage(src, this.document.path),
      )
    );
    this.scribe = boot({
      content: document.content,
      placeholder: "Start writing...",
      readOnly: false,
      markdown: {
        mode: this.mode,
        imageWidgets: {
          controller: this.imageController,
          renderer: createFlowCliImageRenderer(() => {
            const background =
              this.terminalTheme.roles.flowEditorBackground?.background;
            return typeof background === "object" ? background : undefined;
          }),
        },
        onLinkActivate: ({ url }) => {
          void this.openUrl(url);
        },
      },
      onWordCount: (count) => this.updateWordCount(count),
      onChange: (snapshot) => {
        if (snapshot.content !== this.document.content) {
          this.document.updateContent(snapshot.content);
          this.schedulePersistence();
        }
        this.syncContextualEdit();
        this.emit();
      },
    });
    if (recovery && recovery.content !== document.content) {
      this.overlay = { kind: "recovery", snapshot: recovery };
    }
  }

  get activeMode(): Mode {
    return this.mode;
  }

  get document(): DocumentSession {
    return this.currentDocument;
  }

  get terminalTheme() {
    return flowCliThemes[this.settings.theme];
  }

  get terminalCursorStyle() {
    return this.settings.cursor;
  }

  get graphicsPolicy(): FlowCliSettings["graphics"] {
    return this.settings.graphics;
  }

  setExitHandler(handler: () => void): void {
    this.exitHandler = handler;
  }

  requestExit(): boolean {
    if (!this.document.isDirty) return true;
    this.restoreSettingsPreview();
    this.overlay = { kind: "exit" };
    this.message = "";
    this.emit();
    return false;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === "focus") {
      this.menu = null;
      this.scrollbarDragging = false;
    }
    this.scribe.setPresentationMode(mode);
    this.message = `${mode[0]?.toUpperCase()}${mode.slice(1)} mode`;
    this.emit();
  }

  showPalette(): void {
    this.overlay = { kind: "palette", query: "", selected: 0 };
    this.emit();
  }

  showFind(): void {
    if (this.mode === "focus") {
      this.message = "Find is unavailable in Focus mode";
    } else {
      this.overlay = { kind: "find", query: "" };
      this.scribe.executeFind({ action: "clear" });
    }
    this.emit();
  }

  showReplace(): void {
    if (this.mode === "focus" || this.mode === "read") {
      this.message = "Replace is unavailable in this mode";
    } else {
      this.overlay = { kind: "replaceSearch", query: "" };
    }
    this.emit();
  }

  private syncContextualEdit(): void {
    if (
      !this.contextualEditRequested ||
      this.mode === "read" ||
      this.mode === "source" ||
      this.overlay !== null
    ) {
      return;
    }
    const focusedWidgetKey = this.scribe.editor.focusedWidgetKey;
    if (focusedWidgetKey) {
      const image = this.scribe.executeImage({ action: "check" });
      if (typeof image === "object" && image.isImage) {
        if (this.contextualEditSuppressed !== focusedWidgetKey) {
          this.overlay = {
            kind: "imageSource",
            source: image.src,
            alt: image.alt,
            contextualTarget: focusedWidgetKey,
          };
        }
        return;
      }
    }
    const link = this.scribe.executeLink({ action: "check" });
    if (typeof link === "object" && link.isLink) {
      const target = `link:${link.from}:${link.to}`;
      if (this.contextualEditSuppressed !== target) {
        this.overlay = {
          kind: "link",
          text: link.text,
          url: link.url,
          contextualTarget: target,
        };
      }
      return;
    }
    this.contextualEditSuppressed = null;
  }

  private withContextualEditRequest<T>(requested: boolean, run: () => T): T {
    const previous = this.contextualEditRequested;
    this.contextualEditRequested = previous || requested;
    try {
      return run();
    } finally {
      this.contextualEditRequested = previous;
    }
  }

  showOpen(): void {
    const overlay: Extract<Overlay, { kind: "fileBrowser" }> = {
      kind: "fileBrowser",
      directory: this.platform.resolvePath(
        this.platform.directoryName(this.document.path),
      ),
      entries: [],
      selected: 0,
      loading: true,
      request: 0,
    };
    this.overlay = overlay;
    this.loadFileBrowserDirectory(overlay, overlay.directory);
    this.emit();
  }

  showSaveAs(): void {
    this.overlay = {
      kind: "documentPath",
      path: this.document.path,
    };
    this.emit();
  }

  showSettings(): void {
    if (this.settingsSaving) {
      this.message = "Settings are still saving";
      this.emit();
      return;
    }
    const selected = Math.max(
      0,
      flowCliThemeOptions.findIndex(({ id }) => id === this.settings.theme),
    );
    this.overlay = {
      kind: "settings",
      section: "themes",
      themeSelected: selected,
      editorSelected: 0,
      originalSettings: this.settings,
    };
    this.emit();
  }

  newDocument(): Promise<void> {
    return this.replaceDocument();
  }

  copy(cut = false): Promise<void> {
    this.queue(async () => {
      const snapshot = this.scribe.editor.snapshot();
      const selected = textInRange(
        snapshot.doc,
        normalizeRange(snapshot.selection),
      );
      if (!selected) {
        this.message = "Nothing selected";
        this.emit();
        return;
      }
      try {
        await this.platform.clipboard.writeText(selected);
        if (cut) this.scribe.editor.execute(editorCommandNames.deleteBackward);
        this.message = cut ? "Cut selection" : "Copied selection";
      } catch (error) {
        this.message = `Clipboard failed: ${errorMessage(error)}`;
      }
      this.emit();
    });
    return this.pendingOperation;
  }

  paste(): Promise<void> {
    this.queue(async () => {
      try {
        const text = await this.platform.clipboard.readText();
        this.scribe.editor.handleInput({ kind: "paste", text });
        this.message = "Pasted";
      } catch (error) {
        this.message = `Clipboard failed: ${errorMessage(error)}`;
      }
      this.emit();
    });
    return this.pendingOperation;
  }

  save(force = false): Promise<void> {
    this.queue(async () => {
      this.saving = true;
      this.message = "";
      this.emit();
      try {
        await this.document.save(force);
        await this.platform.recovery.clear(this.document.path);
        this.overlay = null;
        this.message = `Saved ${this.document.displayName}`;
        if (this.exitAfterSave) {
          this.exitAfterSave = false;
          this.exitHandler();
        }
      } catch (error) {
        this.exitAfterSave = false;
        if (error instanceof ExternalDocumentChangeError) {
          this.overlay = { kind: "conflict" };
          this.message = "";
        } else {
          this.message = `Save failed: ${errorMessage(error)}`;
        }
      } finally {
        this.saving = false;
        this.emit();
      }
    });
    return this.pendingOperation;
  }

  reload(): Promise<void> {
    this.queue(async () => {
      try {
        await this.document.reload();
        await this.platform.recovery.clear(this.document.path);
        this.scribe.setContent(this.document.content);
        this.overlay = null;
        this.message = `Reloaded ${this.document.displayName}`;
      } catch (error) {
        this.message = `Reload failed: ${errorMessage(error)}`;
      }
      this.emit();
    });
    return this.pendingOperation;
  }

  whenIdle(): Promise<void> {
    return this.pendingOperation;
  }

  prepareForTermination(): Promise<void> {
    this.clearPersistenceTimers();
    return this.writeRecovery();
  }

  frame(width: number, height: number): Frame {
    const availableWidth = Math.max(1, width);
    const availableHeight = Math.max(1, height);
    if (availableHeight === 1 && this.mode !== "focus") {
      return {
        width: availableWidth,
        height: 1,
        rows: [this.statusRow(availableWidth)],
        cursor: { row: 0, column: 0, visible: false },
      };
    }

    const shell = this.editorShell(availableWidth, availableHeight);
    const overlayHeight = Math.max(
      0,
      availableHeight -
        shell.editorHeight -
        (this.mode === "focus" ? 0 : 2),
    );
    const {
      bottomPadding,
      contentHeight,
      editorHeight,
      geometry,
      topPadding,
    } = shell;
    const editorFrame = contentHeight > 0
      ? this.scribe.editor.frame(geometry.contentWidth, contentHeight)
      : {
          width: geometry.contentWidth,
          height: 0,
          rows: [],
          graphics: [],
          cursor: { row: 0, column: 0, visible: false },
        };
    const scroll = this.scribe.editor.scrollState({
      width: geometry.contentWidth,
      height: Math.max(1, contentHeight),
    });
    const paddingRow = () =>
      editorChromeRow(
        { cells: [] },
        availableWidth,
        geometry,
        { text: " ", style: { role: "flowScrollbarTrack" } },
        "flowEditorBackground",
        this.mode === "focus" ? "flowEditorBackground" : "flowEditorMargin",
      );
    const editorRows = [
      ...Array.from({ length: topPadding }, paddingRow),
      ...editorFrame.rows.map((row, index) =>
        editorChromeRow(
          expandInactiveHorizontalRule(row, geometry.contentWidth),
          availableWidth,
          geometry,
          scrollbarCell(scroll, index),
          row.backgroundRole ?? "flowEditorBackground",
          this.mode === "focus" ? "flowEditorBackground" : "flowEditorMargin",
        )
      ),
      ...Array.from({ length: bottomPadding }, paddingRow),
    ];
    const bar = menuBar(menuSections, availableWidth, this.menu?.section ?? null);
    if (this.menu && editorRows.length > 0) {
      const dropdown = this.menuRows(
        editorRows,
        availableWidth,
        bar.segments,
      );
      dropdown.forEach((row, index) => {
        if (index < editorRows.length) editorRows[index] = row;
      });
    }
    const overlayFrame = this.overlayFrame(availableWidth, overlayHeight);
    const overlayCursor = overlayFrame.cursor;
    return {
      ...editorFrame,
      width: availableWidth,
      height: availableHeight,
      rows: [
        ...(this.mode === "focus" ? [] : [bar.row]),
        ...editorRows,
        ...overlayFrame.rows,
        ...(this.mode === "focus" ? [] : [this.statusRow(availableWidth)]),
      ],
      graphics: this.menu
        ? []
        : editorFrame.graphics?.map((graphic) => ({
            ...graphic,
            row: graphic.row + shell.editorTop + topPadding,
            column: graphic.column + geometry.contentColumn,
          })),
      cursor: overlayCursor
        ? {
            row: shell.editorTop + editorHeight + overlayCursor.row,
            column: overlayCursor.column,
            visible: true,
          }
        : this.menu
          ? { row: 0, column: 0, visible: false }
          : {
              ...editorFrame.cursor,
              row: editorFrame.cursor.row + shell.editorTop + topPadding,
              column: editorFrame.cursor.column + geometry.contentColumn,
            },
    };
  }

  handleInput(
    event: InputEvent,
    viewport: { readonly width: number; readonly height: number },
  ): boolean {
    const key = event.kind === "key" ? event.key.toLocaleLowerCase() : "";
    if (event.kind === "mouse" && this.handleChromeMouse(event, viewport)) {
      return true;
    }
    if (this.menu && this.handleMenuInput(event)) return true;
    if (this.overlay && this.handleOverlayInput(event, viewport)) return true;
    if (
      event.kind === "key" &&
      event.key === "Escape" &&
      this.mode === "focus"
    ) {
      this.setMode("edit");
      return true;
    }
    if (event.kind === "key" && this.handleCustomKeybinding(event)) return true;
    if (event.kind === "key" && event.key === "F10") {
      if (this.mode === "focus") return true;
      this.openMenu(0);
      return true;
    }
    if (event.kind === "key" && event.alt) {
      const index = ["f", "e", "v", "i", "o", "h"].indexOf(
        event.key.toLocaleLowerCase(),
      );
      if (index >= 0) {
        if (this.mode === "focus") return true;
        this.openMenu(index);
        return true;
      }
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      event.shift &&
      key === "s"
    ) {
      return this.runCommand("flow.saveAs");
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === "n"
    ) {
      return this.runCommand("flow.new");
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === "o"
    ) {
      return this.runCommand("flow.open");
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === "c"
    ) {
      return this.runCommand("flow.copy");
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === "x"
    ) {
      return this.runCommand("flow.cut");
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === "v"
    ) {
      return this.runCommand("flow.paste");
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === ","
    ) {
      this.showSettings();
      return true;
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === "p"
    ) {
      this.showPalette();
      return true;
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === "f"
    ) {
      return this.runCommand("flow.find");
    }
    if (
      event.kind === "key" &&
      hasPrimaryModifier(event) &&
      key === "h"
    ) {
      return this.runCommand("flow.replace");
    }
    if (event.kind === "key" && event.key === "F2") {
      this.setMode("focus");
      return true;
    }
    if (event.kind === "key" && event.key === "F3") {
      this.setMode("edit");
      return true;
    }
    if (event.kind === "key" && event.key === "F4") {
      this.setMode("read");
      return true;
    }
    if (event.kind === "key" && event.key === "F5") {
      this.setMode("source");
      return true;
    }
    if (event.kind === "key" && event.key === "F1") {
      this.overlay = { kind: "help" };
      this.emit();
      return true;
    }
    if (event.kind === "mouse") return true;
    const shell = this.editorShell(viewport.width, viewport.height);
    return this.withContextualEditRequest(
      event.kind === "key" &&
        (event.key === "ArrowUp" || event.key === "ArrowDown"),
      () => this.scribe.editor.handleInput(event, {
        width: shell.geometry.contentWidth,
        height: Math.max(1, shell.contentHeight),
      }),
    );
  }

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearPersistenceTimers();
    this.imageController.dispose();
    this.scribe.destroy();
    this.listeners.clear();
  }

  private handleOverlayInput(
    event: InputEvent,
    viewport: { readonly width: number; readonly height: number },
  ): boolean {
    const overlay = this.overlay;
    if (!overlay) return false;
    const contextualTarget = "contextualTarget" in overlay
      ? overlay.contextualTarget
      : undefined;
    if (
      contextualTarget &&
      event.kind === "key" &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      this.contextualEditSuppressed = contextualTarget;
      this.overlay = null;
      const shell = this.editorShell(viewport.width, viewport.height);
      this.withContextualEditRequest(true, () =>
        this.scribe.editor.handleInput(event, {
          width: shell.geometry.contentWidth,
          height: Math.max(1, shell.contentHeight),
        })
      );
      this.emit();
      return true;
    }
    if (overlay.kind === "settings" && event.kind === "mouse") {
      if (event.action === "press" && event.button === "left") {
        const shell = this.editorShell(viewport.width, viewport.height);
        const overlayHeight = Math.max(
          0,
          viewport.height -
            shell.editorHeight -
            (this.mode === "focus" ? 0 : 2),
        );
        const overlayStart = shell.editorTop + shell.editorHeight;
        if (event.row === overlayStart) {
          if (event.column >= 11 && event.column < 19) {
            overlay.section = "themes";
          } else if (event.column >= 21 && event.column < 29) {
            overlay.section = "editor";
          }
          this.emit();
          return true;
        }
        const window = this.settingsWindow(overlay, overlayHeight);
        const visibleIndex = event.row - (overlayStart + 2);
        const itemIndex = window.start + visibleIndex;
        if (visibleIndex >= 0 && visibleIndex < window.count) {
          this.selectSettingsItem(overlay, itemIndex);
          if (
            overlay.section === "editor" &&
            (itemIndex === cursorShapeSettingIndex ||
              itemIndex === cursorBlinkingSettingIndex)
          ) {
            this.adjustCursorSetting(itemIndex, 1);
          }
          this.applySettings(overlay);
        }
      }
      return true;
    }
    if (overlay.kind === "fileBrowser" && event.kind === "mouse") {
      if (event.action === "press" && event.button === "left") {
        const shell = this.editorShell(viewport.width, viewport.height);
        const overlayHeight = Math.max(
          0,
          viewport.height -
            shell.editorHeight -
            (this.mode === "focus" ? 0 : 2),
        );
        const overlayStart = shell.editorTop + shell.editorHeight;
        const grid = this.fileBrowserGrid(
          viewport.width,
          overlayHeight,
          overlay.selected,
          overlay.entries.length,
        );
        const row = event.row - overlayStart - 2;
        const column = Math.floor(event.column / grid.cellWidth);
        if (row >= 0 && row < grid.rows && column < grid.columns) {
          const index = grid.start + row * grid.columns + column;
          if (index < overlay.entries.length) {
            overlay.selected = index;
            this.activateFileBrowserEntry(overlay);
          }
        }
      }
      return true;
    }
    if (
      overlay.kind === "about" &&
      event.kind === "mouse" &&
      event.action === "press" &&
      event.button === "left"
    ) {
      const frame = this.frame(viewport.width, viewport.height);
      const row = frame.rows.findIndex((candidate) =>
        candidate.cells.some((cell) => cell.style.role === "markdownLink")
      );
      const column = row >= 0
        ? frame.rows[row]?.cells.findIndex((cell) =>
          cell.style.role === "markdownLink"
        ) ?? -1
        : -1;
      if (
        event.row === row &&
        column >= 0 &&
        event.column >= column &&
        event.column < column + displayWidth(flowCliWebsite)
      ) {
        void this.openUrl(flowCliWebsite);
      }
      return true;
    }
    if (event.kind === "mouse" || event.kind === "resize") return true;
    if (event.kind === "key" && event.key === "Escape") {
      if (overlay.kind === "find") {
        this.scribe.executeFind({ action: "clear" });
      } else if (overlay.kind === "settings") {
        this.restoreSettingsPreview();
      }
      this.overlay = null;
      this.exitAfterSave = false;
      this.emit();
      return true;
    }
    if (
      overlay.kind === "exit" ||
      overlay.kind === "conflict" ||
      overlay.kind === "recovery"
    ) {
      return this.handleConfirmationInput(overlay, event);
    }
    if (overlay.kind === "help" || overlay.kind === "about") {
      if (event.kind === "key" || event.kind === "text") {
        this.overlay = null;
        this.emit();
      }
      return true;
    }
    if (overlay.kind === "settings") {
      return this.handleSettingsInput(overlay, event);
    }
    if (overlay.kind === "palette") {
      return this.handlePaletteInput(overlay, event);
    }
    if (overlay.kind === "fileBrowser") {
      return this.handleFileBrowserInput(overlay, event, viewport);
    }
    return this.handlePromptInput(overlay, event);
  }

  private handleFileBrowserInput(
    overlay: Extract<Overlay, { kind: "fileBrowser" }>,
    event: InputEvent,
    viewport: { readonly width: number; readonly height: number },
  ): boolean {
    if (event.kind !== "key") return true;
    if (event.key === "Backspace") {
      const parent = this.platform.directoryName(overlay.directory);
      if (parent !== overlay.directory) {
        this.loadFileBrowserDirectory(overlay, parent);
      }
      return true;
    }
    if (overlay.loading || overlay.entries.length === 0) return true;
    const shell = this.editorShell(viewport.width, viewport.height);
    const overlayHeight = Math.max(
      0,
      viewport.height -
        shell.editorHeight -
        (this.mode === "focus" ? 0 : 2),
    );
    const grid = this.fileBrowserGrid(
      viewport.width,
      overlayHeight,
      overlay.selected,
      overlay.entries.length,
    );
    if (event.key === "ArrowLeft") {
      overlay.selected = Math.max(0, overlay.selected - 1);
    } else if (event.key === "ArrowRight") {
      overlay.selected = Math.min(
        overlay.entries.length - 1,
        overlay.selected + 1,
      );
    } else if (event.key === "ArrowUp") {
      overlay.selected = Math.max(0, overlay.selected - grid.columns);
    } else if (event.key === "ArrowDown") {
      overlay.selected = Math.min(
        overlay.entries.length - 1,
        overlay.selected + grid.columns,
      );
    } else if (event.key === "Home") {
      overlay.selected = 0;
    } else if (event.key === "End") {
      overlay.selected = overlay.entries.length - 1;
    } else if (event.key === "PageUp") {
      overlay.selected = Math.max(0, overlay.selected - grid.capacity);
    } else if (event.key === "PageDown") {
      overlay.selected = Math.min(
        overlay.entries.length - 1,
        overlay.selected + grid.capacity,
      );
    } else if (event.key === "Enter") {
      this.activateFileBrowserEntry(overlay);
    }
    this.emit();
    return true;
  }

  private handleSettingsInput(
    overlay: Extract<Overlay, { kind: "settings" }>,
    event: InputEvent,
  ): boolean {
    if (event.kind !== "key") return true;
    if (event.key === "Tab") {
      overlay.section = overlay.section === "themes" ? "editor" : "themes";
      this.emit();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const count = this.settingsItemCount(overlay);
      const selected =
        (this.settingsSelected(overlay) + direction + count) % count;
      this.selectSettingsItem(overlay, selected);
    } else if (event.key === "Home") {
      this.selectSettingsItem(overlay, 0);
    } else if (event.key === "End") {
      this.selectSettingsItem(overlay, this.settingsItemCount(overlay) - 1);
    } else if (
      overlay.section === "editor" &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      this.adjustCursorSetting(
        overlay.editorSelected,
        event.key === "ArrowLeft" ? -1 : 1,
      );
    } else if (event.key === "Enter") {
      this.applySettings(overlay);
    }
    return true;
  }

  private selectSettingsItem(
    overlay: Extract<Overlay, { kind: "settings" }>,
    selected: number,
  ): void {
    if (overlay.section === "themes") {
      overlay.themeSelected = selected;
      const theme = flowCliThemeOptions[selected];
      if (theme) this.settings = { ...this.settings, theme: theme.id };
    } else {
      overlay.editorSelected = selected;
    }
    this.emit();
  }

  private settingsItemCount(
    overlay: Extract<Overlay, { kind: "settings" }>,
  ): number {
    return overlay.section === "themes"
      ? flowCliThemeOptions.length
      : editorSettingsItemCount;
  }

  private settingsSelected(
    overlay: Extract<Overlay, { kind: "settings" }>,
  ): number {
    return overlay.section === "themes"
      ? overlay.themeSelected
      : overlay.editorSelected;
  }

  private adjustCursorSetting(selected: number, direction: number): void {
    if (selected === cursorShapeSettingIndex) {
      const current = cursorShapeOptions.findIndex(
        ({ id }) => id === this.settings.cursor.shape,
      );
      const next =
        (current + direction + cursorShapeOptions.length) %
        cursorShapeOptions.length;
      const shape = cursorShapeOptions[next]?.id;
      if (!shape) return;
      this.settings = {
        ...this.settings,
        cursor: { ...this.settings.cursor, shape },
      };
      this.emit();
    } else if (selected === cursorBlinkingSettingIndex) {
      this.settings = {
        ...this.settings,
        cursor: {
          ...this.settings.cursor,
          blinking: !this.settings.cursor.blinking,
        },
      };
      this.emit();
    }
  }

  private applySettings(
    overlay: Extract<Overlay, { kind: "settings" }>,
  ): void {
    const settings = this.settings;
    this.overlay = null;
    this.message = "Settings updated";
    this.settingsSaving = true;
    this.queue(async () => {
      try {
        await this.platform.settings.save(settings);
      } catch (error) {
        this.settings = {
          ...this.settings,
          theme: this.settings.theme === settings.theme
            ? overlay.originalSettings.theme
            : this.settings.theme,
          cursor: this.settings.cursor === settings.cursor
            ? overlay.originalSettings.cursor
            : this.settings.cursor,
        };
        this.message = `Settings failed: ${errorMessage(error)}`;
      } finally {
        this.settingsSaving = false;
      }
      this.emit();
    });
    this.emit();
  }

  private restoreSettingsPreview(): void {
    if (this.overlay?.kind !== "settings") return;
    this.settings = this.overlay.originalSettings;
  }

  private settingsWindow(
    overlay: Extract<Overlay, { kind: "settings" }>,
    height: number,
  ): { readonly start: number; readonly count: number } {
    const itemCount = this.settingsItemCount(overlay);
    const count = Math.min(
      itemCount,
      Math.max(0, height - 2),
    );
    const start = Math.max(
      0,
      Math.min(
        itemCount - count,
        this.settingsSelected(overlay) - Math.floor(count / 2),
      ),
    );
    return { start, count };
  }

  private handleConfirmationInput(
    overlay: Extract<Overlay,     { kind: "exit" | "conflict" | "recovery" }>,
    event: InputEvent,
  ): boolean {
    if (event.kind !== "key") return true;
    if (overlay.kind === "exit") {
      if (event.key === "y") {
        this.exitAfterSave = true;
        void this.save();
      } else if (event.key === "n") {
        this.overlay = null;
        this.exitHandler();
      }
    } else if (overlay.kind === "recovery") {
      if (event.key === "r") {
        this.document.updateContent(overlay.snapshot.content);
        this.scribe.setContent(overlay.snapshot.content);
        this.overlay = null;
        this.message = "Recovered unsaved work";
        this.schedulePersistence();
      } else if (event.key === "d") {
        this.overlay = null;
        void this.clearRecovery();
      }
    } else if (event.key === "o") {
      void this.save(true);
    } else if (event.key === "r") {
      void this.reload();
    }
    return true;
  }

  private handlePaletteInput(
    overlay: Extract<Overlay, { kind: "palette" }>,
    event: InputEvent,
  ): boolean {
    if (event.kind === "text" || event.kind === "paste") {
      overlay.query += singleLine(event.text);
      overlay.selected = 0;
    } else if (event.kind === "key" && event.key === "Backspace") {
      overlay.query = removeLastGrapheme(overlay.query);
      overlay.selected = 0;
    } else if (event.kind === "key" && event.key === "ArrowDown") {
      const count = this.paletteItems(overlay.query).length;
      overlay.selected = count > 0 ? (overlay.selected + 1) % count : 0;
    } else if (event.kind === "key" && event.key === "ArrowUp") {
      const count = this.paletteItems(overlay.query).length;
      overlay.selected = count > 0
        ? (overlay.selected - 1 + count) % count
        : 0;
    } else if (event.kind === "key" && event.key === "Enter") {
      const item = this.paletteItems(overlay.query)[overlay.selected];
      if (item?.enabled) {
        this.overlay = null;
        item.run();
      }
    }
    this.emit();
    return true;
  }

  private handlePromptInput(
    overlay: Exclude<
      Overlay,
      {
        kind:
          | "exit"
          | "conflict"
          | "recovery"
          | "palette"
          | "help"
          | "about"
          | "settings"
          | "fileBrowser";
      }
    >,
    event: InputEvent,
  ): boolean {
    const append = event.kind === "text" || event.kind === "paste"
      ? singleLine(event.text)
      : null;
    const backspace = event.kind === "key" && event.key === "Backspace";
    const enter = event.kind === "key" && event.key === "Enter";
    if (overlay.kind === "find") {
      if (append !== null) overlay.query += append;
      if (backspace) overlay.query = removeLastGrapheme(overlay.query);
      if (append !== null || backspace) {
        const result = this.scribe.executeFind({
          action: "find",
          searchText: overlay.query,
        });
        this.message = result.totalMatches === 0
          ? "No matches"
          : `${result.currentMatchIndex + 1} of ${result.totalMatches}`;
      } else if (enter) {
        const result = this.scribe.executeFind({ action: "next" });
        this.message = result.totalMatches === 0
          ? "No matches"
          : `${result.currentMatchIndex + 1} of ${result.totalMatches}`;
      }
    } else if (overlay.kind === "replaceSearch") {
      if (append !== null) overlay.query += append;
      if (backspace) overlay.query = removeLastGrapheme(overlay.query);
      if (enter && overlay.query) {
        this.overlay = {
          kind: "replaceWith",
          search: overlay.query,
          replacement: "",
        };
      }
    } else if (overlay.kind === "replaceWith") {
      if (append !== null) overlay.replacement += append;
      if (backspace) {
        overlay.replacement = removeLastGrapheme(overlay.replacement);
      }
      if (enter || (event.kind === "key" && event.ctrl && event.key === "a")) {
        const result = this.scribe.executeReplace({
          action:
            event.kind === "key" && event.ctrl && event.key === "a"
              ? "replaceAll"
              : "replace",
          searchText: overlay.search,
          replaceText: overlay.replacement,
        });
        this.message = `${result.replacements} replacement${
          result.replacements === 1 ? "" : "s"
        }`;
        if (result.totalMatches === 0) this.overlay = null;
      }
    } else if (overlay.kind === "link") {
      if (append !== null) overlay.url += append;
      if (backspace) overlay.url = removeLastGrapheme(overlay.url);
      if (enter && overlay.url.trim()) {
        if (overlay.contextualTarget) {
          this.contextualEditSuppressed = overlay.contextualTarget;
        }
        this.scribe.executeLink({
          action: "apply",
          text: overlay.text,
          url: overlay.url,
        });
        this.overlay = null;
      }
    } else if (overlay.kind === "imageSource") {
      if (append !== null) overlay.source += append;
      if (backspace) overlay.source = removeLastGrapheme(overlay.source);
      if (enter && overlay.source.trim()) {
        this.overlay = {
          kind: "imageAlt",
          source: overlay.source,
          alt: overlay.alt,
          contextualTarget: overlay.contextualTarget,
        };
      }
    } else if (overlay.kind === "imageAlt") {
      if (append !== null) overlay.alt += append;
      if (backspace) overlay.alt = removeLastGrapheme(overlay.alt);
      if (enter) {
        if (overlay.contextualTarget) {
          this.contextualEditSuppressed = overlay.contextualTarget;
        }
        this.scribe.executeImage({
          action: "apply",
          src: overlay.source,
          alt: overlay.alt,
        });
        this.overlay = null;
      }
    } else if (overlay.kind === "export") {
      if (append !== null) overlay.path += append;
      if (backspace) overlay.path = removeLastGrapheme(overlay.path);
      if (enter && overlay.path.trim()) {
        void this.exportDocument(overlay.format, overlay.path.trim());
      }
    } else {
      if (append !== null) overlay.path += append;
      if (backspace) overlay.path = removeLastGrapheme(overlay.path);
      if (enter && overlay.path.trim()) {
        const resolved = this.platform.resolvePath(overlay.path.trim());
        void this.saveAs(resolved);
      }
    }
    this.emit();
    return true;
  }

  private paletteItems(query: string): readonly PaletteItem[] {
    const normalized = query.trim().toLocaleLowerCase();
    const commands = new Map(
      this.commandItems().map((item) => [item.id, item]),
    );
    return menuSections
      .flatMap((section) => section.itemIds)
      .flatMap((id) => {
        const item = id === null ? undefined : commands.get(id);
        return item ? [item] : [];
      })
      .filter((item) =>
        normalized.length === 0 ||
        `${item.label} ${item.id}`.toLocaleLowerCase().includes(normalized)
      );
  }

  private commandItems(): readonly PaletteItem[] {
    const appItems: readonly PaletteItem[] = [
      this.appItem("flow.new", "New Document", "Ctrl+N", true, () =>
        void this.newDocument()),
      this.appItem("flow.open", "Open Document...", "Ctrl+O", true, () =>
        this.showOpen()),
      this.appItem("flow.saveAs", "Save As...", "Ctrl+Shift+S", true, () =>
        this.showSaveAs()),
      this.appItem(
        "flow.mode.edit",
        "Mode: Edit",
        "F3",
        true,
        () => this.setMode("edit"),
        this.mode === "edit",
      ),
      this.appItem(
        "flow.mode.focus",
        "Mode: Focus",
        "F2",
        true,
        () => this.setMode("focus"),
        this.mode === "focus",
      ),
      this.appItem(
        "flow.mode.read",
        "Mode: Read",
        "F4",
        true,
        () => this.setMode("read"),
        this.mode === "read",
      ),
      this.appItem(
        "flow.mode.source",
        "Mode: Source",
        "F5",
        true,
        () => this.setMode("source"),
        this.mode === "source",
      ),
      this.appItem(
        "flow.find",
        "Find",
        "Ctrl+F",
        this.mode !== "focus",
        () => this.showFind(),
      ),
      this.appItem(
        "flow.replace",
        "Replace",
        "Ctrl+H",
        this.mode !== "focus" && this.mode !== "read",
        () => this.showReplace(),
      ),
      this.appItem(
        "flow.settings",
        "Settings...",
        "Ctrl+,",
        true,
        () => this.showSettings(),
      ),
      this.appItem("flow.copy", "Copy", "Ctrl/Cmd+C", true, () => void this.copy()),
      this.appItem(
        "flow.cut",
        "Cut",
        "Ctrl/Cmd+X",
        this.mode !== "read",
        () => void this.copy(true),
      ),
      this.appItem(
        "flow.paste",
        "Paste",
        "Ctrl/Cmd+V",
        this.mode !== "read",
        () => void this.paste(),
      ),
      this.appItem(
        "flow.link",
        "Link",
        undefined,
        this.mode !== "read",
        () => {
          const link = this.scribe.executeLink({ action: "check" });
          if (typeof link === "object") {
            this.overlay = { kind: "link", text: link.text, url: link.url };
          }
        },
      ),
      this.appItem(
        "flow.image",
        "Image",
        undefined,
        this.mode !== "read",
        () => {
          const image = this.scribe.executeImage({ action: "check" });
          this.overlay = {
            kind: "imageSource",
            source: typeof image === "object" ? image.src : "",
            alt: typeof image === "object" ? image.alt : "",
          };
        },
      ),
      this.appItem("flow.help", "Shortcut Help", "F1", true, () => {
        this.overlay = { kind: "help" };
      }),
      this.appItem("flow.about", "About Flow CLI", undefined, true, () => {
        this.overlay = { kind: "about" };
      }),
      this.appItem("flow.export.html", "Export: HTML", undefined, true, () => {
        this.overlay = {
          kind: "export",
          format: "html",
          path: this.exportPath("html"),
        };
      }),
      this.appItem(
        "flow.export.text",
        "Export: Plain Text",
        undefined,
        true,
        () => {
          this.overlay = {
            kind: "export",
            format: "text",
            path: this.exportPath("txt"),
          };
        },
      ),
      this.appItem("flow.exit", "Exit", "Ctrl+Q", true, () => {
        if (this.requestExit()) this.exitHandler();
      }),
    ];
    const scribeItems = [
      ...this.scribe.commandRegistry.getSerializedCommandData().values(),
    ].map((command) => this.scribePaletteItem(command));
    return [...appItems, ...scribeItems];
  }

  private appItem(
    id: string,
    label: string,
    accelerator: string | undefined,
    enabled: boolean,
    run: () => void,
    checked?: boolean,
  ): PaletteItem {
    return { id, label, accelerator, enabled, run, checked };
  }

  private scribePaletteItem(command: CommandData): PaletteItem {
    return {
      id: command.id,
      label: command.label,
      accelerator: command.accelerator,
      enabled: command.enabled,
      checked: command.active,
      run: () => {
        if (this.scribe.executeCommand(command.id)) {
          this.message = command.label;
        }
      },
    };
  }

  private editorShell(width: number, height: number): EditorShell {
    const chromeHeight = this.mode === "focus" ? 0 : 2;
    const overlayHeight = Math.min(
      this.desiredOverlayHeight(),
      Math.max(0, Math.max(1, height) - chromeHeight - 1),
    );
    const editorHeight = Math.max(
      0,
      Math.max(1, height) - overlayHeight - chromeHeight,
    );
    const vertical = editorVerticalGeometry(editorHeight);
    return {
      editorTop: this.mode === "focus" ? 0 : 1,
      editorHeight,
      ...vertical,
      geometry: editorChromeGeometry(
        Math.max(1, width),
        80,
        this.mode !== "focus",
      ),
    };
  }

  private openMenu(section: number): void {
    const resolvedSection = Math.max(
      0,
      Math.min(menuSections.length - 1, section),
    );
    this.restoreSettingsPreview();
    this.overlay = null;
    this.menu = {
      section: resolvedSection,
      item: this.nextMenuItem(resolvedSection, -1, 1),
    };
    this.emit();
  }

  private menuEntries(section: number): readonly (PaletteItem | null)[] {
    const items = new Map(this.commandItems().map((item) => [item.id, item]));
    return (menuSections[section]?.itemIds ?? []).map((id) =>
      id === null ? null : items.get(id) ?? null
    );
  }

  private nextMenuItem(section: number, item: number, direction: number): number {
    const entries = this.menuEntries(section);
    if (entries.length === 0) return -1;
    let next = item;
    for (let count = 0; count < entries.length; count += 1) {
      next = (next + direction + entries.length) % entries.length;
      if (entries[next]?.enabled) return next;
    }
    return -1;
  }

  private handleMenuInput(event: InputEvent): boolean {
    const menu = this.menu;
    if (!menu) return false;
    if (event.kind !== "key") return true;
    if (event.key === "Escape" || event.key === "F10") {
      this.menu = null;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const section =
        (menu.section + direction + menuSections.length) % menuSections.length;
      this.menu = {
        section,
        item: this.nextMenuItem(section, -1, 1),
      };
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      menu.item = this.nextMenuItem(
        menu.section,
        menu.item,
        event.key === "ArrowUp" ? -1 : 1,
      );
    } else if (event.key === "Enter") {
      const item = this.menuEntries(menu.section)[menu.item];
      if (item?.enabled) {
        this.menu = null;
        item.run();
      }
    }
    this.emit();
    return true;
  }

  private handleChromeMouse(
    event: Extract<InputEvent, { kind: "mouse" }>,
    viewport: { readonly width: number; readonly height: number },
  ): boolean {
    const shell = this.editorShell(viewport.width, viewport.height);
    const bar = menuBar(menuSections, viewport.width, this.menu?.section ?? null);
    if (
      !this.menu &&
      !this.overlay &&
      this.mode !== "focus" &&
      event.row === viewport.height - 1 &&
      event.action === "press" &&
      event.button === "left"
    ) {
      const item = this.statusModeSegments().find(
        (segment) =>
          event.column >= segment.from && event.column < segment.to,
      );
      if (item) {
        this.setMode(item.mode);
        return true;
      }
    }
    if (
      this.mode !== "focus" &&
      event.row === 0 &&
      event.action === "press" &&
      event.button === "left"
    ) {
      const section = bar.segments.findIndex(
        (segment) => event.column >= segment.from && event.column < segment.to,
      );
      if (section >= 0) this.openMenu(section);
      else if (this.menu) {
        this.menu = null;
        this.emit();
      }
      return true;
    }

    if (this.menu) {
      if (event.action === "press" && event.button === "left") {
        const box = this.menuBox(
          viewport.width,
          shell.editorHeight,
          bar.segments,
        );
        const item = box.firstItem + event.row - 2;
        const selected = box.entries[item];
        const inside = event.column >= box.start &&
          event.column < box.start + box.width &&
          event.row >= 2 &&
          event.row < 2 + box.visibleItems;
        if (inside && selected?.enabled) {
          this.menu.item = item;
          this.menu = null;
          selected.run();
        } else if (!inside || !selected) {
          this.menu = null;
        }
        this.emit();
      }
      return true;
    }

    if (this.overlay) return false;
    const editorRow = event.row - shell.editorTop;
    const contentRow = editorRow - shell.topPadding;
    if (
      this.scrollbarDragging &&
      (event.action === "move" || event.action === "release")
    ) {
      if (event.action === "move") {
        const denominator = Math.max(1, shell.contentHeight - 1);
        const row = Math.max(0, Math.min(shell.contentHeight - 1, contentRow));
        this.scribe.editor.scrollToFraction(row / denominator, {
          width: shell.geometry.contentWidth,
          height: Math.max(1, shell.contentHeight),
        });
        this.emit();
      } else {
        this.scrollbarDragging = false;
      }
      return true;
    }
    if (
      event.column === shell.geometry.scrollbarColumn &&
      contentRow >= 0 &&
      contentRow < shell.contentHeight
    ) {
      if (event.action === "wheel") {
        this.scribe.editor.scrollBy(
          event.button === "wheelUp" ? -3 : event.button === "wheelDown" ? 3 : 0,
          {
            width: shell.geometry.contentWidth,
            height: Math.max(1, shell.contentHeight),
          },
        );
        this.emit();
        return true;
      }
      if (event.action === "press" && event.button === "left") {
        this.scrollbarDragging = true;
      }
      if (
        (event.action === "press" || event.action === "move") &&
        (event.button === "left" || this.scrollbarDragging)
      ) {
        const denominator = Math.max(1, shell.contentHeight - 1);
        this.scribe.editor.scrollToFraction(contentRow / denominator, {
          width: shell.geometry.contentWidth,
          height: Math.max(1, shell.contentHeight),
        });
        this.emit();
      }
      if (event.action === "release") this.scrollbarDragging = false;
      return true;
    }
    if (event.action === "release" && this.scrollbarDragging) {
      this.scrollbarDragging = false;
      return true;
    }
    if (editorRow < 0 || editorRow >= shell.editorHeight) return false;
    if (contentRow < 0 || contentRow >= shell.contentHeight) return true;
    const contextualClick =
      event.action === "press" && event.button === "right";
    this.withContextualEditRequest(contextualClick, () =>
      this.scribe.editor.handleInput(
        {
          ...event,
          button: contextualClick ? "left" : event.button,
          row: contentRow,
          column: Math.max(
            0,
            Math.min(
              shell.geometry.contentWidth - 1,
              event.column - shell.geometry.contentColumn,
            ),
          ),
        },
        {
          width: shell.geometry.contentWidth,
          height: Math.max(1, shell.contentHeight),
        },
      )
    );
    return true;
  }

  private menuRows(
    baseRows: readonly FrameRow[],
    width: number,
    segments: readonly MenuBarSegment[],
  ): Frame["rows"] {
    const menu = this.menu;
    const height = baseRows.length;
    if (!menu || height <= 0) return [];
    const box = this.menuBox(width, height, segments);
    const horizontal = "─".repeat(Math.max(0, box.width - 2));
    const visibleEntries = box.entries.slice(
      box.firstItem,
      box.firstItem + box.visibleItems,
    );
    const rows = [
      positionedRow(
        baseRows[0]!,
        `┌${horizontal}┐`,
        box.start,
        width,
        "flowMenuDropdown",
      ),
      ...visibleEntries.map((item, visibleIndex) => {
        const index = box.firstItem + visibleIndex;
        if (!item) {
          return positionedRow(
            baseRows[visibleIndex + 1]!,
            `├${horizontal}┤`,
            box.start,
            width,
            "flowMenuDropdown",
          );
        }
        const mark = item.checked ? "✓" : " ";
        const accelerator = item.accelerator ?? "";
        const fixedWidth =
          displayWidth(mark) + displayWidth(item.label) +
          displayWidth(accelerator) + 5;
        const gap = " ".repeat(Math.max(1, box.width - fixedWidth));
        const content = ` ${mark} ${item.label}${gap}${accelerator} `;
        const row = positionedRow(
          baseRows[visibleIndex + 1]!,
          `│${content}│`,
          box.start,
          width,
          "flowMenuDropdown",
        );
        if (!item.enabled) {
          return positionedRow(
            row,
            content,
            box.start + 1,
            width,
            "flowMenuDisabled",
          );
        }
        return index === menu.item
          ? positionedRow(
              row,
              content,
              box.start + 1,
              width,
              "flowMenuSelected",
            )
          : row;
      }),
      positionedRow(
        baseRows[Math.min(baseRows.length - 1, visibleEntries.length + 1)]!,
        `└${horizontal}┘`,
        box.start,
        width,
        "flowMenuDropdown",
      ),
    ];
    return rows.slice(0, height);
  }

  private menuBox(
    width: number,
    height: number,
    segments: readonly MenuBarSegment[],
  ): MenuBox {
    const menu = this.menu;
    const entries = menu ? this.menuEntries(menu.section) : [];
    const start = menu ? segments[menu.section]?.from ?? 0 : 0;
    const contentWidth = Math.max(
      8,
      ...entries.map((item) =>
        item
          ? displayWidth(item.label) + displayWidth(item.accelerator ?? "") + 5
          : 0
      ),
    );
    const boxWidth = Math.min(Math.max(1, width - start), contentWidth + 2);
    const visibleItems = Math.max(0, Math.min(entries.length, height - 2));
    const firstItem = Math.max(
      0,
      Math.min(
        (menu?.item ?? 0) - visibleItems + 1,
        entries.length - visibleItems,
      ),
    );
    return {
      entries,
      start,
      width: boxWidth,
      firstItem,
      visibleItems,
    };
  }

  private fileBrowserGrid(
    width: number,
    height: number,
    selected: number,
    entryCount: number,
  ): FileBrowserGrid {
    const columns = Math.max(1, Math.floor(Math.max(1, width) / 20));
    const rows = Math.max(0, height - 3);
    const cellWidth = Math.max(1, Math.floor(Math.max(1, width) / columns));
    const capacity = Math.max(1, columns * rows);
    const page = Math.floor(Math.max(0, selected) / capacity);
    return {
      columns,
      rows,
      cellWidth,
      capacity,
      start: Math.min(
        page * capacity,
        Math.max(0, entryCount - capacity),
      ),
    };
  }

  private loadFileBrowserDirectory(
    overlay: Extract<Overlay, { kind: "fileBrowser" }>,
    directory: string,
  ): void {
    const request = overlay.request + 1;
    overlay.request = request;
    overlay.directory = directory;
    overlay.entries = [];
    overlay.selected = 0;
    overlay.loading = true;
    overlay.error = undefined;
    this.emit();
    this.queue(async () => {
      try {
        const visibleEntries = (await this.platform.files.readDirectory(directory))
          .filter((entry) =>
            !entry.name.startsWith(".") &&
            (entry.kind === "directory" || /\.md$/iu.test(entry.name))
          )
          .sort((left, right) =>
            left.kind === right.kind
              ? left.name.localeCompare(right.name)
              : left.kind === "directory" ? -1 : 1
          );
        const parent = this.platform.directoryName(directory);
        const entries: readonly DirectoryEntry[] = parent === directory
          ? visibleEntries
          : [
              {
                name: "..",
                path: parent,
                kind: "directory",
              },
              ...visibleEntries,
            ];
        if (this.overlay !== overlay || overlay.request !== request) return;
        overlay.entries = entries;
        overlay.loading = false;
      } catch (error) {
        if (this.overlay !== overlay || overlay.request !== request) return;
        overlay.loading = false;
        overlay.error = errorMessage(error);
      }
      this.emit();
    });
  }

  private activateFileBrowserEntry(
    overlay: Extract<Overlay, { kind: "fileBrowser" }>,
  ): void {
    const entry = overlay.entries[overlay.selected];
    if (!entry) return;
    if (entry.kind === "directory") {
      this.loadFileBrowserDirectory(overlay, entry.path);
    } else {
      void this.replaceDocument(entry.path);
    }
  }

  private desiredOverlayHeight(): number {
    if (!this.overlay) return 0;
    if (this.overlay.kind === "palette") {
      return Math.min(7, this.paletteItems(this.overlay.query).length + 1);
    }
    if (this.overlay.kind === "help") return 12;
    if (this.overlay.kind === "about") return 5;
    if (this.overlay.kind === "fileBrowser") return 8;
    if (this.overlay.kind === "settings") {
      return flowCliThemeOptions.length + 2;
    }
    if (
      this.overlay.kind === "exit" ||
      this.overlay.kind === "conflict" ||
      this.overlay.kind === "recovery"
    ) return 0;
    return 1;
  }

  private overlayFrame(width: number, height: number): OverlayFrame {
    if (!this.overlay || height === 0) return { rows: [] };
    if (this.overlay.kind === "palette") {
      const palette = this.overlay;
      const items = this.paletteItems(palette.query);
      palette.selected = Math.min(
        palette.selected,
        Math.max(0, items.length - 1),
      );
      const visibleCount = Math.max(0, height - 1);
      const start = Math.max(
        0,
        Math.min(
          palette.selected - visibleCount + 1,
          items.length - visibleCount,
        ),
      );
      const rows = [
        {
          cells: rowCells(
            ` Command: ${palette.query}`,
            width,
            "flowOverlay",
          ),
        },
        ...items.slice(start, start + visibleCount).map((item, index) => ({
          cells: rowCells(
            `${start + index === palette.selected ? ">" : " "} ${
              item.enabled ? "" : "x "
            }${item.label}${
              item.accelerator ? `  ${item.accelerator}` : ""
            }`,
            width,
            start + index === palette.selected
              ? "flowOverlaySelected"
              : "flowOverlay",
          ),
        })),
      ];
      return {
        rows,
        cursor: {
          row: 0,
          column: Math.min(width - 1, displayWidth(" Command: ") +
            displayWidth(palette.query)),
        },
      };
    }
    if (this.overlay.kind === "help") {
      return {
        rows: [
          " Flow shortcut help",
          " F10  Menu bar",
          " F2/F3/F4/F5  Focus / Edit / Read / Source",
          " Ctrl+,  Settings",
          " Ctrl+P  Command palette",
          " Ctrl+F  Find",
          " Ctrl+H  Replace",
          " Ctrl+C/X/V  Copy / Cut / Paste (Cmd when supported)",
          " Ctrl+Q  Exit",
          " F1  Toggle this help",
          " Press any key to close",
        ].slice(0, height).map((line, index) => ({
          cells: rowCells(
            line,
            width,
            index === 0 ? "flowOverlaySelected" : "flowOverlay",
          ),
        })),
      };
    }
    if (this.overlay.kind === "about") {
      const rows = [
        {
          cells: rowCells(" Flow CLI", width, "flowOverlaySelected"),
        },
        {
          cells: rowCells(
            " Keyboard-first Markdown writing for the terminal",
            width,
            "flowOverlay",
          ),
        },
        {
          cells: rowCells(" Version 0.1.0", width, "flowOverlay"),
        },
        positionedRow(
          { cells: rowCells(` ${flowCliWebsite}`, width, "flowOverlay") },
          flowCliWebsite,
          1,
          width,
          "markdownLink",
        ),
        {
          cells: rowCells(" Press any key to close", width, "flowOverlay"),
        },
      ];
      return {
        rows: rows.slice(0, height),
      };
    }
    if (this.overlay.kind === "settings") {
      const settings = this.overlay;
      const window = this.settingsWindow(settings, height);
      const shape = cursorShapeOptions.find(
        ({ id }) => id === this.settings.cursor.shape,
      );
      const items = settings.section === "themes"
        ? flowCliThemeOptions.map((theme) =>
          `${theme.id === this.settings.theme ? "✓" : " "} ${theme.label}`
        )
        : [
            `Cursor shape: ${shape?.label ?? "Block"}  ←/→`,
            `Cursor blinking: ${
              this.settings.cursor.blinking ? "On" : "Off"
            }  ←/→`,
          ];
      const selected = this.settingsSelected(settings);
      const rows = [
        {
          cells: rowCells(
            ` Settings  ${
              settings.section === "themes" ? "[Themes]" : " Themes "
            }  ${settings.section === "editor" ? "[Editor]" : " Editor "}`,
            width,
            "flowOverlaySelected",
          ),
        },
        {
          cells: rowCells(
            settings.section === "themes"
              ? " Tab section  ↑/↓ preview  Enter apply  Esc cancel"
              : " Tab section  ↑/↓ select  ←/→ change  Enter apply  Esc cancel",
            width,
            "flowOverlay",
          ),
        },
        ...items
          .slice(window.start, window.start + window.count)
          .map((item, visibleIndex) => {
            const index = window.start + visibleIndex;
            return {
              cells: rowCells(
                `${index === selected ? ">" : " "} ${item}`,
                width,
                index === selected
                  ? "flowOverlaySelected"
                  : "flowOverlay",
              ),
            };
          }),
      ].slice(0, height);
      while (rows.length < height) {
        rows.push({ cells: rowCells("", width, "flowOverlay") });
      }
      return { rows };
    }
    if (this.overlay.kind === "fileBrowser") {
      const browser = this.overlay;
      const grid = this.fileBrowserGrid(
        width,
        height,
        browser.selected,
        browser.entries.length,
      );
      const rows: { cells: readonly Cell[] }[] = [
        {
          cells: rowCells(
            " Open Markdown",
            width,
            "flowOverlaySelected",
          ),
        },
        {
          cells: rowCells(` ${browser.directory}`, width, "flowOverlay"),
        },
      ];
      if (browser.loading) {
        rows.push({ cells: rowCells(" Loading…", width, "flowOverlay") });
      } else if (browser.error) {
        rows.push({
          cells: rowCells(` Error: ${browser.error}`, width, "flowOverlay"),
        });
      } else if (browser.entries.length === 0) {
        rows.push({
          cells: rowCells(" No folders or Markdown files", width, "flowOverlay"),
        });
      } else {
        for (let row = 0; row < grid.rows; row += 1) {
          const cells: Cell[] = [];
          for (let column = 0; column < grid.columns; column += 1) {
            const index = grid.start + row * grid.columns + column;
            const entry = browser.entries[index];
            const label = entry
              ? entry.kind === "directory"
                ? ` ▸ ${entry.name}${entry.name === ".." ? "" : "/"}`
                : `   ${entry.name}`
              : "";
            cells.push(...rowCells(
              label,
              grid.cellWidth,
              index === browser.selected
                ? "flowOverlaySelected"
                : "flowOverlay",
            ));
          }
          cells.push(...rowCells(
            "",
            Math.max(0, width - cells.length),
            "flowOverlay",
          ));
          rows.push({ cells: cells.slice(0, width) });
        }
      }
      while (rows.length < Math.max(0, height - 1)) {
        rows.push({ cells: rowCells("", width, "flowOverlay") });
      }
      rows.push({
        cells: rowCells(
          " Arrows navigate  Enter open  Backspace parent  Esc close",
          width,
          "flowOverlay",
        ),
      });
      return { rows: rows.slice(0, height) };
    }
    if (
      this.overlay.kind === "exit" ||
      this.overlay.kind === "conflict" ||
      this.overlay.kind === "recovery"
    ) {
      return { rows: [] };
    }
    const prompt = this.promptText(this.overlay);
    return {
      rows: [{
        cells: rowCells(prompt.text, width, "flowOverlay"),
      }],
      cursor: {
        row: 0,
        column: Math.min(
          width - 1,
          prompt.cursorColumn ?? displayWidth(prompt.text),
        ),
      },
    };
  }

  private promptText(
    overlay: Exclude<
      Overlay,
      {
        kind:
          | "exit"
          | "conflict"
          | "recovery"
          | "palette"
          | "help"
          | "about"
          | "settings"
          | "fileBrowser";
      }
    >,
  ): { readonly text: string; readonly cursorColumn?: number } {
    switch (overlay.kind) {
      case "find":
        return { text: ` Find: ${overlay.query}` };
      case "replaceSearch":
        return { text: ` Replace: ${overlay.query}` };
      case "replaceWith":
        {
          const input =
            ` Replace "${overlay.search}" with: ${overlay.replacement}`;
          return {
            text: `${input}  [Enter current, Ctrl+A all]`,
            cursorColumn: displayWidth(input),
          };
        }
      case "link":
        return { text: ` Link URL: ${overlay.url}` };
      case "imageSource":
        return { text: ` Image source: ${overlay.source}` };
      case "imageAlt":
        return { text: ` Image alt text: ${overlay.alt}` };
      case "export":
        return { text: ` Export ${overlay.format.toUpperCase()} to: ${overlay.path}` };
      case "documentPath":
        return { text: ` Save as: ${overlay.path}` };
    }
  }

  private statusText(): string | null {
    if (this.overlay?.kind === "exit") {
      return " Unsaved changes - [y] save  [n] discard  [esc] cancel";
    }
    if (this.overlay?.kind === "conflict") {
      return " File changed on disk - [o] overwrite  [r] reload  [esc] cancel";
    }
    if (this.overlay?.kind === "recovery") {
      return " Unsaved recovery found - [r] restore  [d] discard";
    }
    return null;
  }

  private statusRow(width: number): Frame["rows"][number] {
    const blockingStatus = this.statusText();
    if (blockingStatus) {
      return {
        cells: rowCells(blockingStatus, width, "flowStatus"),
      };
    }
    const modeSegments = this.statusModeSegments();
    const modes = modeSegments.map(({ text }) => text).join("  ");
    const message = this.saving ? "Saving…" : this.message;
    const hints = message
      ? `${modes}  ${message}`
      : `${modes}  F10 Menu  ^P Cmds`;
    const wordLabel = `${this.wordCount} ${
      this.wordCount === 1 ? "word" : "words"
    }`;
    const words = this.wordCountIsSelection ? `[${wordLabel}]` : wordLabel;
    const row = statusBar(` ${hints}`, `${words} `, width);
    const active = modeSegments.find(({ mode }) => mode === this.mode);
    return active
      ? {
          ...row,
          cells: row.cells.map((cell, index) =>
            index >= active.from - 1 && index < active.to + 1
              ? { ...cell, style: { role: "flowStatusActive" } }
              : cell
          ),
        }
      : row;
  }

  private statusModeSegments(): readonly {
    readonly mode: Mode;
    readonly text: string;
    readonly from: number;
    readonly to: number;
  }[] {
    let column = 1;
    return statusModeItems.map(({ key, label, mode }) => {
      const text = `${key} ${label}`;
      const from = column;
      column += displayWidth(text);
      const segment = { mode, text, from, to: column };
      column += 2;
      return segment;
    });
  }

  private updateWordCount(count: WordCount): void {
    this.wordCount = count.words;
    this.wordCountIsSelection = count.isSelection;
    this.emit();
  }

  private queue(operation: () => Promise<void>): void {
    this.pendingOperation = this.pendingOperation.then(operation);
  }

  private schedulePersistence(): void {
    if (this.recoveryTimer !== null) {
      this.platform.timers.clearTimeout(this.recoveryTimer);
    }
    this.recoveryTimer = this.platform.timers.setTimeout(() => {
      this.recoveryTimer = null;
      void this.writeRecovery();
    }, 250);
    if (this.autosaveTimer !== null) {
      this.platform.timers.clearTimeout(this.autosaveTimer);
    }
    this.autosaveTimer = this.platform.timers.setTimeout(() => {
      this.autosaveTimer = null;
      if (this.document.isDirty) void this.save();
    }, this.settings.autosaveDelayMs);
  }

  private writeRecovery(): Promise<void> {
    this.queue(async () => {
      try {
        if (this.document.isDirty) {
          await this.platform.recovery.save({
            documentPath: this.document.path,
            content: this.document.content,
            savedAt: new Date().toISOString(),
          });
        } else {
          await this.platform.recovery.clear(this.document.path);
        }
      } catch (error) {
        this.message = `Recovery failed: ${errorMessage(error)}`;
        this.emit();
      }
    });
    return this.pendingOperation;
  }

  private clearRecovery(): Promise<void> {
    this.queue(async () => {
      try {
        await this.platform.recovery.clear(this.document.path);
        this.message = "Discarded recovery";
      } catch (error) {
        this.message = `Recovery failed: ${errorMessage(error)}`;
      }
      this.emit();
    });
    return this.pendingOperation;
  }

  private handleCustomKeybinding(event: InputEvent): boolean {
    for (const [commandId, key] of Object.entries(this.settings.keybindings)) {
      if (!keyBindingMatches(event, { key, command: commandId })) continue;
      const command = this.commandItems().find((item) => item.id === commandId);
      if (!command) continue;
      if (!command.enabled) return true;
      command.run();
      this.emit();
      return true;
    }
    return false;
  }

  private runCommand(commandId: string): boolean {
    const command = this.commandItems().find((item) => item.id === commandId);
    if (!command) return false;
    if (command.enabled) command.run();
    this.emit();
    return true;
  }

  private exportPath(extension: string): string {
    return this.document.path.replace(/(?:\.[^/\\.]*)?$/u, `.${extension}`);
  }

  private exportDocument(
    format: "html" | "text",
    path: string,
  ): Promise<void> {
    this.queue(async () => {
      try {
        const content = format === "html"
          ? renderMarkdownToHtml(this.document.content, {
              title: this.document.displayName.replace(/\.md$/iu, ""),
            })
          : markdownToPlainText(this.document.content);
        await this.platform.files.writeAtomic(path, content);
        this.overlay = null;
        this.message = `Exported ${path}`;
      } catch (error) {
        this.message = `Export failed: ${errorMessage(error)}`;
      }
      this.emit();
    });
    return this.pendingOperation;
  }

  private saveAs(path: string): Promise<void> {
    this.queue(async () => {
      const previousPath = this.document.path;
      try {
        await this.document.saveAs(path);
        await this.platform.recovery.clear(previousPath);
        this.overlay = null;
        this.message = `Saved ${this.document.displayName}`;
      } catch (error) {
        this.message = `Save As failed: ${errorMessage(error)}`;
      }
      this.emit();
    });
    return this.pendingOperation;
  }

  private replaceDocument(path?: string): Promise<void> {
    this.clearPersistenceTimers();
    this.queue(async () => {
      const previousPath = this.document.path;
      try {
        if (this.document.isDirty) await this.document.save();
        await this.platform.recovery.clear(previousPath);
        const next = await openDocumentSession(this.platform.files, path);
        this.currentDocument = next;
        this.scribe.setContent(next.content);
        this.overlay = null;
        this.message = path
          ? `Opened ${next.displayName}`
          : `New ${next.displayName}`;
      } catch (error) {
        this.message = `${path ? "Open" : "New"} failed: ${errorMessage(error)}`;
      }
      this.emit();
    });
    return this.pendingOperation;
  }

  private clearPersistenceTimers(): void {
    if (this.recoveryTimer !== null) {
      this.platform.timers.clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (this.autosaveTimer !== null) {
      this.platform.timers.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }

  private async openUrl(url: string): Promise<void> {
    try {
      await this.platform.system.openUrl(url);
      this.message = `Opened ${url}`;
    } catch (error) {
      this.message = `Open failed: ${errorMessage(error)}`;
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const createFlowCliApp = async (
  platform: FlowCliPlatform,
  filePath?: string,
): Promise<FlowCliApp> => {
  const document = await openDocumentSession(platform.files, filePath);
  const [settings, recovery] = await Promise.all([
    platform.settings.load(),
    platform.recovery.load(document.path),
  ]);
  return new FlowCliApp(document, platform, settings, recovery);
};

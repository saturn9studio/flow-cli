import {
  TerminalEditor,
  type EditorPlugin,
  type EditorStateSnapshot,
  type TerminalEditorOptions,
} from "../engine/index.js";
import {
  commandToEditorCommand,
  CommandRegistry,
  createDefaultCommands,
  defaultFlowKeymap,
  executeImageAction,
  executeLinkAction,
  executeTableInsert,
  markdownKeyboardCommands,
  markdownKeyboardKeymap,
  type Command,
  type ImageCommandArgs,
  type ImageResult,
  type LinkCommandArgs,
  type LinkResult,
  type TableCommandArgs,
} from "./commands/index.js";
import {
  executeHighlightColorAction,
  type HighlightColorCommandArgs,
  type HighlightColorResult,
} from "./highlight.js";
import {
  createLintController,
  type LintController,
  type LintControllerOptions,
  type LintProvider,
} from "./lint.js";
import {
  withCurrentSentence,
  withDocumentChanged,
  withLintDecorations,
  withPlaceholderText,
  withWordCount,
  type WordCount,
} from "./plugins.js";
import {
  executeFindCommand,
  executeReplaceCommand,
  withSearch,
  type FindCommandArgs,
  type FindResult,
  type ReplaceCommandArgs,
  type ReplaceResult,
} from "./search.js";
import {
  markdownPlugin,
  type MarkdownPluginOptions,
  type MarkdownPresentationMode,
} from "./presentation/plugin.js";
import {
  markdownBlockWidgetsPlugin,
  type MarkdownBlockWidgetOptions,
} from "./presentation/blocks.js";
import { markdownSyntaxProvider } from "./presentation/syntax.js";

export type FlowCliPluginFactory = () => EditorPlugin<unknown>;

export interface FlowCliBootOptions {
  readonly content?: string;
  readonly readOnly?: boolean;
  readonly markdown?: boolean | MarkdownPluginOptions;
  readonly blockWidgets?: false | Omit<MarkdownBlockWidgetOptions, "mode">;
  readonly placeholder?: string;
  readonly search?: boolean;
  readonly currentSentence?: boolean;
  readonly onDocumentChanged?: (content: string) => void;
  readonly onWordCount?: (count: WordCount) => void;
  readonly lintDecorations?: boolean;
  readonly lint?: {
    readonly provider: LintProvider;
  } & LintControllerOptions;
  readonly plugins?: readonly FlowCliPluginFactory[];
  readonly commands?: readonly Command[];
  readonly commandRegistry?: CommandRegistry;
  readonly keymap?: TerminalEditorOptions["keymap"];
  readonly tabSize?: number;
  readonly onChange?: (snapshot: EditorStateSnapshot) => void;
}

export interface FlowCliEditor {
  readonly editor: TerminalEditor;
  readonly commandRegistry: CommandRegistry;
  getContent(): string;
  setContent(content: string): void;
  setReadOnly(readOnly: boolean): void;
  setPresentationMode(mode: MarkdownPresentationMode): void;
  executeCommand(commandId: string): boolean;
  executeFind(args: FindCommandArgs): FindResult;
  executeReplace(args: ReplaceCommandArgs): ReplaceResult;
  executeLink(args: LinkCommandArgs): LinkResult | boolean;
  executeImage(args: ImageCommandArgs): ImageResult | boolean;
  insertTable(args?: TableCommandArgs): boolean;
  executeHighlightColor(
    args: HighlightColorCommandArgs,
  ): HighlightColorResult | boolean;
  destroy(): void;
}

export const boot = (
  options: FlowCliBootOptions = {},
): FlowCliEditor => {
  const markdownEnabled = options.markdown !== false;
  const markdownOptions =
    typeof options.markdown === "object" ? options.markdown : undefined;
  let presentationMode = markdownOptions?.mode ?? "edit";
  let configuredReadOnly = options.readOnly ?? false;
  let lintController: LintController | null = null;
  const staticPlugins: EditorPlugin<unknown>[] = [
    ...(options.search === false ? [] : [withSearch()]),
    ...(options.lintDecorations === false ? [] : [withLintDecorations()]),
    ...(options.placeholder ? [withPlaceholderText(options.placeholder)] : []),
    ...(options.currentSentence ? [withCurrentSentence()] : []),
    ...(options.onWordCount ? [withWordCount(options.onWordCount)] : []),
    ...(options.onDocumentChanged || options.lint
      ? [withDocumentChanged((content) => {
          options.onDocumentChanged?.(content);
          lintController?.run();
        })]
      : []),
    ...(options.plugins ?? []).map((factory) => factory()),
  ];
  const plugins = (): readonly EditorPlugin<unknown>[] => [
    ...(markdownEnabled
      ? [markdownPlugin({ ...markdownOptions, mode: presentationMode })]
      : []),
    ...(markdownEnabled && options.blockWidgets !== false
      ? [markdownBlockWidgetsPlugin({
          ...options.blockWidgets,
          mode: presentationMode,
        })]
      : []),
    ...staticPlugins,
  ];
  const commandRegistry = options.commandRegistry ?? new CommandRegistry();
  const unregisterCommands = commandRegistry.registerMany([
    ...createDefaultCommands(),
    ...(options.commands ?? []),
  ]);
  const editor = new TerminalEditor({
    content: options.content,
    readOnly: presentationMode === "read" ? true : configuredReadOnly,
    syntaxProvider: markdownEnabled ? markdownSyntaxProvider : undefined,
    plugins: plugins(),
    commands: [
      ...commandRegistry.getAllCommands().map(commandToEditorCommand),
      ...(markdownEnabled ? markdownKeyboardCommands : []),
    ],
    keymap: [
      ...(options.keymap ?? []),
      ...(markdownEnabled ? markdownKeyboardKeymap : []),
      ...defaultFlowKeymap,
    ],
    tabSize: options.tabSize,
    onChange: (snapshot) => {
      commandRegistry.emitUpdate();
      options.onChange?.(snapshot);
    },
  });
  const unbindRegistry = commandRegistry.bind(editor);
  const unsubscribeImages =
    typeof markdownOptions?.imageWidgets === "object"
      ? markdownOptions.imageWidgets.controller?.onUpdate(() =>
          editor.invalidatePresentation()
        )
      : undefined;
  if (options.lint) {
    lintController = createLintController(editor, options.lint.provider, options.lint);
    lintController.run();
  }

  return {
    editor,
    commandRegistry,
    getContent: () => editor.snapshot().content,
    setContent: (content) => editor.setContent(content),
    setReadOnly: (readOnly) => {
      configuredReadOnly = readOnly;
      editor.setReadOnly(presentationMode === "read" ? true : readOnly);
    },
    setPresentationMode: (mode) => {
      presentationMode = mode;
      editor.setReadOnly(mode === "read" ? true : configuredReadOnly);
      editor.setPlugins(plugins());
    },
    executeCommand: (commandId) => commandRegistry.executeCommand(commandId),
    executeFind: (args) => executeFindCommand(editor, args),
    executeReplace: (args) => executeReplaceCommand(editor, args),
    executeLink: (args) => executeLinkAction(editor, args),
    executeImage: (args) => executeImageAction(editor, args),
    insertTable: (args) => executeTableInsert(editor, args),
    executeHighlightColor: (args) => executeHighlightColorAction(editor, args),
    destroy: () => {
      unbindRegistry();
      unregisterCommands();
      lintController?.dispose();
      unsubscribeImages?.();
      editor.destroy();
    },
  };
};

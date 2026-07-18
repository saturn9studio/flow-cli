import type { EditorSnapshot } from "./decorations.js";
import type { InputEvent } from "./input.js";
import type { Transaction } from "./transaction.js";

export interface EditorCommandContext extends EditorSnapshot {
  dispatch(transaction: Transaction): void;
  execute(commandName: string): boolean;
}

export interface EditorCommand {
  readonly name: string;
  run(context: EditorCommandContext): boolean;
}

export interface EditorKeyBinding {
  readonly key: string;
  readonly command: string;
}

export const editorCommandNames = Object.freeze({
  deleteBackward: "editor.deleteBackward",
  deleteForward: "editor.deleteForward",
  deleteWordBackward: "editor.deleteWordBackward",
  deleteWordForward: "editor.deleteWordForward",
  insertLineBreak: "editor.insertLineBreak",
  moveDocumentEnd: "editor.moveDocumentEnd",
  moveDocumentEndExtend: "editor.moveDocumentEndExtend",
  moveDocumentStart: "editor.moveDocumentStart",
  moveDocumentStartExtend: "editor.moveDocumentStartExtend",
  moveDown: "editor.moveDown",
  moveDownExtend: "editor.moveDownExtend",
  moveLeft: "editor.moveLeft",
  moveLeftExtend: "editor.moveLeftExtend",
  moveLineEnd: "editor.moveLineEnd",
  moveLineEndExtend: "editor.moveLineEndExtend",
  moveLineStart: "editor.moveLineStart",
  moveLineStartExtend: "editor.moveLineStartExtend",
  moveRight: "editor.moveRight",
  moveRightExtend: "editor.moveRightExtend",
  moveUp: "editor.moveUp",
  moveUpExtend: "editor.moveUpExtend",
  moveWordLeft: "editor.moveWordLeft",
  moveWordLeftExtend: "editor.moveWordLeftExtend",
  moveWordRight: "editor.moveWordRight",
  moveWordRightExtend: "editor.moveWordRightExtend",
  redo: "editor.redo",
  selectAll: "editor.selectAll",
  undo: "editor.undo",
});

interface ParsedKeyBinding {
  readonly key: string;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly mod: boolean;
  readonly shift: boolean;
}

const parseKeyBinding = (binding: string): ParsedKeyBinding | null => {
  const parts = binding.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts[parts.length - 1];
  if (!key) return null;
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  return {
    key: key.toLowerCase(),
    alt: modifiers.has("alt") || modifiers.has("option"),
    ctrl: modifiers.has("ctrl") || modifiers.has("control"),
    meta: modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command"),
    mod: modifiers.has("mod"),
    shift: modifiers.has("shift"),
  };
};

export const keyBindingMatches = (
  event: InputEvent,
  binding: EditorKeyBinding,
): boolean => {
  if (event.kind !== "key") return false;
  const parsed = parseKeyBinding(binding.key);
  if (!parsed) return false;
  const commandModifierMatches = parsed.mod
    ? Boolean(event.ctrl || event.meta)
    : Boolean(event.ctrl) === parsed.ctrl && Boolean(event.meta) === parsed.meta;
  return commandModifierMatches &&
    Boolean(event.alt) === parsed.alt &&
    Boolean(event.shift) === parsed.shift &&
    event.key.toLowerCase() === parsed.key;
};

const key = (binding: string, command: string): EditorKeyBinding => ({
  key: binding,
  command,
});

const wordNavigationKeymap = ["Alt", "Ctrl", "Ctrl+Alt"].flatMap(
  (modifier) => [
    key(`${modifier}+ArrowLeft`, editorCommandNames.moveWordLeft),
    key(`${modifier}+ArrowRight`, editorCommandNames.moveWordRight),
    key(`${modifier}+Shift+ArrowLeft`, editorCommandNames.moveWordLeftExtend),
    key(`${modifier}+Shift+ArrowRight`, editorCommandNames.moveWordRightExtend),
  ],
);

const wordDeletionKeymap = ["Alt", "Ctrl", "Ctrl+Alt"].flatMap((modifier) => [
  key(`${modifier}+Backspace`, editorCommandNames.deleteWordBackward),
  key(`${modifier}+Delete`, editorCommandNames.deleteWordForward),
]);

export const defaultEditorKeymap: readonly EditorKeyBinding[] = [
  key("Mod+Shift+Z", editorCommandNames.redo),
  key("Mod+Y", editorCommandNames.redo),
  key("Mod+Z", editorCommandNames.undo),
  key("Mod+A", editorCommandNames.selectAll),
  ...wordNavigationKeymap,
  key("Meta+Shift+ArrowLeft", editorCommandNames.moveLineStartExtend),
  key("Meta+Shift+ArrowRight", editorCommandNames.moveLineEndExtend),
  key("Meta+Shift+ArrowUp", editorCommandNames.moveDocumentStartExtend),
  key("Meta+Shift+ArrowDown", editorCommandNames.moveDocumentEndExtend),
  key("Meta+ArrowLeft", editorCommandNames.moveLineStart),
  key("Meta+ArrowRight", editorCommandNames.moveLineEnd),
  key("Meta+ArrowUp", editorCommandNames.moveDocumentStart),
  key("Meta+ArrowDown", editorCommandNames.moveDocumentEnd),
  key("Ctrl+Shift+Home", editorCommandNames.moveDocumentStartExtend),
  key("Ctrl+Shift+End", editorCommandNames.moveDocumentEndExtend),
  key("Ctrl+Home", editorCommandNames.moveDocumentStart),
  key("Ctrl+End", editorCommandNames.moveDocumentEnd),
  key("Shift+ArrowLeft", editorCommandNames.moveLeftExtend),
  key("Shift+ArrowRight", editorCommandNames.moveRightExtend),
  key("Shift+ArrowUp", editorCommandNames.moveUpExtend),
  key("Shift+ArrowDown", editorCommandNames.moveDownExtend),
  key("ArrowLeft", editorCommandNames.moveLeft),
  key("ArrowRight", editorCommandNames.moveRight),
  key("ArrowUp", editorCommandNames.moveUp),
  key("ArrowDown", editorCommandNames.moveDown),
  key("Shift+Home", editorCommandNames.moveLineStartExtend),
  key("Shift+End", editorCommandNames.moveLineEndExtend),
  key("Home", editorCommandNames.moveLineStart),
  key("End", editorCommandNames.moveLineEnd),
  key("Enter", editorCommandNames.insertLineBreak),
  ...wordDeletionKeymap,
  key("Backspace", editorCommandNames.deleteBackward),
  key("Delete", editorCommandNames.deleteForward),
];

import type { TerminalEditor } from "../../engine/index.js";
import {
  commandDataFromCommand,
  unavailableCommandDataFromCommand,
  type Command,
  type CommandData,
  type CommandStatusContext,
  type SerializedCommandRegistry,
} from "./command.js";

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly listeners = new Set<() => void>();
  private editor: TerminalEditor | null = null;

  register(command: Command): () => void {
    this.commands.set(command.id, command);
    this.emitUpdate();
    return () => this.unregister(command.id);
  }

  registerMany(commands: readonly Command[]): () => void {
    const disposers = commands.map((command) => this.register(command));
    return () => disposers.forEach((dispose) => dispose());
  }

  unregister(commandId: string): boolean {
    const deleted = this.commands.delete(commandId);
    if (deleted) this.emitUpdate();
    return deleted;
  }

  bind(editor: TerminalEditor): () => void {
    this.editor = editor;
    this.emitUpdate();
    return () => {
      if (this.editor !== editor) return;
      this.editor = null;
      this.emitUpdate();
    };
  }

  getCommand(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  getAllCommands(): readonly Command[] {
    return [...this.commands.values()];
  }

  getCommandData(commandId: string): CommandData | undefined {
    const command = this.commands.get(commandId);
    if (!command) return undefined;
    return this.editor
      ? commandDataFromCommand(command, this.editor.snapshot() as CommandStatusContext)
      : unavailableCommandDataFromCommand(command);
  }

  getSerializedCommandData(): SerializedCommandRegistry {
    return new Map(
      this.getAllCommands().map((command) => [
        command.id,
        this.getCommandData(command.id)!,
      ]),
    );
  }

  executeCommand(commandId: string): boolean {
    const command = this.commands.get(commandId);
    const editor = this.editor;
    if (!command || !editor) return false;
    const snapshot = editor.snapshot();
    if (command.enabled?.(snapshot) === false) return false;
    return command.run({
      ...snapshot,
      dispatch: (transaction) => editor.dispatch(transaction),
      execute: (name) => editor.execute(name),
    });
  }

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitUpdate(): void {
    this.listeners.forEach((listener) => listener());
  }
}

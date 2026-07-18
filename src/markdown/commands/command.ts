import type {
  EditorCommand,
  EditorCommandContext,
  EditorSnapshot,
} from "../../engine/index.js";

export interface CommandStatusContext extends EditorSnapshot {
  readonly revision?: number;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
}

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly accelerator?: string;
  readonly group?: string;
  readonly enabled?: (context: CommandStatusContext) => boolean;
  readonly active?: (context: CommandStatusContext) => boolean;
  readonly run: (context: EditorCommandContext) => boolean;
}

export interface CommandData {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly accelerator?: string;
  readonly group?: string;
  readonly enabled: boolean;
  readonly active?: boolean;
  readonly type: "normal" | "checkbox";
  readonly checked?: boolean;
}

export type SerializedCommandRegistry = ReadonlyMap<string, CommandData>;

export const commandToEditorCommand = (command: Command): EditorCommand => ({
  name: command.id,
  run(context) {
    if (command.enabled?.(context) === false) return false;
    return command.run(context);
  },
});

export const commandDataFromCommand = (
  command: Command,
  context: CommandStatusContext,
): CommandData => {
  const checked = command.active?.(context);
  return {
    id: command.id,
    label: command.label,
    description: command.description,
    accelerator: command.accelerator,
    group: command.group,
    enabled: command.enabled?.(context) ?? true,
    active: checked,
    type: checked === undefined ? "normal" : "checkbox",
    checked,
  };
};

export const unavailableCommandDataFromCommand = (
  command: Command,
): CommandData => {
  const active = command.active ? false : undefined;
  return {
    id: command.id,
    label: command.label,
    description: command.description,
    accelerator: command.accelerator,
    group: command.group,
    enabled: false,
    active,
    type: command.active ? "checkbox" : "normal",
    checked: active,
  };
};

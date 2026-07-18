export interface InputModifiers {
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

export type KeyAction = "press" | "repeat" | "release";

export interface KeyInputEvent extends InputModifiers {
  readonly kind: "key";
  readonly key: string;
  readonly action?: KeyAction;
}

export type MouseButton =
  | "left"
  | "middle"
  | "right"
  | "none"
  | "wheelUp"
  | "wheelDown"
  | "wheelLeft"
  | "wheelRight";

export type MouseAction = "press" | "release" | "move" | "wheel";

export interface MouseInputEvent extends InputModifiers {
  readonly kind: "mouse";
  readonly action: MouseAction;
  readonly button: MouseButton;
  readonly column: number;
  readonly row: number;
}

export type InputEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "paste"; readonly text: string }
  | KeyInputEvent
  | { readonly kind: "resize"; readonly columns: number; readonly rows: number }
  | MouseInputEvent;

const keyEvent = (key: string, modifiers: InputModifiers = {}): InputEvent => ({
  kind: "key",
  key,
  ...modifiers,
});

const modifiersFromCode = (encoded: number): InputModifiers => {
  const modifiers = Math.max(0, encoded - 1);
  return {
    ...((modifiers & 1) !== 0 ? { shift: true } : {}),
    ...((modifiers & 2) !== 0 ? { alt: true } : {}),
    ...((modifiers & 4) !== 0 ? { ctrl: true } : {}),
    ...((modifiers & (8 | 32)) !== 0 ? { meta: true } : {}),
  };
};

const functionalKey = (parameter: number, final: string): string | undefined => {
  const finalKeys: Readonly<Record<string, string>> = {
    A: "ArrowUp",
    B: "ArrowDown",
    C: "ArrowRight",
    D: "ArrowLeft",
    F: "End",
    H: "Home",
    P: "F1",
    Q: "F2",
    R: "F3",
    S: "F4",
  };
  if (final !== "~") return finalKeys[final];
  return new Map<number, string>([
    [2, "Insert"],
    [3, "Delete"],
    [5, "PageUp"],
    [6, "PageDown"],
    [7, "Home"],
    [8, "End"],
    [11, "F1"],
    [12, "F2"],
    [13, "F3"],
    [14, "F4"],
    [15, "F5"],
    [17, "F6"],
    [18, "F7"],
    [19, "F8"],
    [20, "F9"],
    [21, "F10"],
    [23, "F11"],
    [24, "F12"],
  ]).get(parameter);
};

const keyFromCodePoint = (codePoint: number): string | undefined => {
  const named = new Map<number, string>([
    [9, "Tab"],
    [13, "Enter"],
    [27, "Escape"],
    [127, "Backspace"],
    [57358, "CapsLock"],
    [57359, "ScrollLock"],
    [57360, "NumLock"],
    [57361, "PrintScreen"],
    [57362, "Pause"],
    [57363, "Menu"],
  ]).get(codePoint);
  if (named) return named;
  if (codePoint >= 57376 && codePoint <= 57398) {
    return `F${codePoint - 57363}`;
  }
  return codePoint > 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : undefined;
};

const decodeModifiedKey = (
  parameter: number,
  modifierCode: number,
  final: string,
  eventCode?: number,
): KeyInputEvent | undefined => {
  const key = functionalKey(parameter, final);
  if (!key) return undefined;
  const action: KeyAction = eventCode === 2
    ? "repeat"
    : eventCode === 3
      ? "release"
      : "press";
  return {
    kind: "key",
    key,
    ...modifiersFromCode(modifierCode),
    ...(action === "press" ? {} : { action }),
  };
};

const escapeSequences: Readonly<Record<string, InputEvent>> = {
  "\u001bOP": keyEvent("F1"),
  "\u001bOQ": keyEvent("F2"),
  "\u001bOR": keyEvent("F3"),
  "\u001bOS": keyEvent("F4"),
  "\u001b[11~": keyEvent("F1"),
  "\u001b[12~": keyEvent("F2"),
  "\u001b[13~": keyEvent("F3"),
  "\u001b[14~": keyEvent("F4"),
  "\u001b[15~": keyEvent("F5"),
  "\u001b[17~": keyEvent("F6"),
  "\u001b[18~": keyEvent("F7"),
  "\u001b[19~": keyEvent("F8"),
  "\u001b[20~": keyEvent("F9"),
  "\u001b[21~": keyEvent("F10"),
  "\u001b[23~": keyEvent("F11"),
  "\u001b[24~": keyEvent("F12"),
  "\u001b[A": keyEvent("ArrowUp"),
  "\u001b[B": keyEvent("ArrowDown"),
  "\u001b[C": keyEvent("ArrowRight"),
  "\u001b[D": keyEvent("ArrowLeft"),
  "\u001b[1;2A": keyEvent("ArrowUp", { shift: true }),
  "\u001b[1;2B": keyEvent("ArrowDown", { shift: true }),
  "\u001b[1;2C": keyEvent("ArrowRight", { shift: true }),
  "\u001b[1;2D": keyEvent("ArrowLeft", { shift: true }),
  "\u001b[H": keyEvent("Home"),
  "\u001b[F": keyEvent("End"),
  "\u001b[Z": keyEvent("Tab", { shift: true }),
  "\u001b[3~": keyEvent("Delete"),
  "\u001b": keyEvent("Escape"),
  "\r": keyEvent("Enter"),
  "\n": keyEvent("Enter"),
  "\u007f": keyEvent("Backspace"),
  "\b": keyEvent("Backspace"),
  "\t": keyEvent("Tab"),
  "\u001a": keyEvent("z", { ctrl: true }),
  "\u0019": keyEvent("y", { ctrl: true }),
  "\u0011": keyEvent("q", { ctrl: true }),
  "\u0003": keyEvent("c", { ctrl: true }),
};

const mouseButton = (
  code: number,
  action: MouseAction,
): MouseButton => {
  if (action === "wheel") {
    return ["wheelUp", "wheelDown", "wheelLeft", "wheelRight"][code & 3] as MouseButton;
  }
  return ["left", "middle", "right", "none"][code & 3] as MouseButton;
};

const decodeSgrMouse = (sequence: RegExpExecArray): MouseInputEvent => {
  const code = Number(sequence[1]);
  const terminator = sequence[4];
  const action: MouseAction = (code & 64) !== 0
    ? "wheel"
    : terminator === "m"
      ? "release"
      : (code & 32) !== 0
        ? "move"
        : "press";
  return {
    kind: "mouse",
    action,
    button: mouseButton(code, action),
    column: Math.max(0, Number(sequence[2]) - 1),
    row: Math.max(0, Number(sequence[3]) - 1),
    ...((code & 4) !== 0 ? { shift: true } : {}),
    ...((code & 8) !== 0 ? { alt: true } : {}),
    ...((code & 16) !== 0 ? { ctrl: true } : {}),
  };
};

export class TerminalInputDecoder {
  private buffer = "";
  private paste = false;
  private pasteBuffer = "";

  push(chunk: string): readonly InputEvent[] {
    this.buffer += chunk;
    const events: InputEvent[] = [];

    while (this.buffer.length > 0) {
      if (this.paste) {
        const end = this.buffer.indexOf("\u001b[201~");
        if (end === -1) {
          this.pasteBuffer += this.buffer;
          this.buffer = "";
          break;
        }
        this.pasteBuffer += this.buffer.slice(0, end);
        events.push({ kind: "paste", text: this.pasteBuffer });
        this.pasteBuffer = "";
        this.paste = false;
        this.buffer = this.buffer.slice(end + 6);
        continue;
      }

      if (this.buffer.startsWith("\u001b[200~")) {
        this.paste = true;
        this.buffer = this.buffer.slice(6);
        continue;
      }

      if (this.buffer.startsWith("\u001b[<")) {
        const mouse = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/u.exec(this.buffer);
        if (mouse) {
          events.push(decodeSgrMouse(mouse));
          this.buffer = this.buffer.slice(mouse[0].length);
          continue;
        }
        if (/^\u001b\[<[0-9;]*$/u.test(this.buffer)) break;
      }

      const csiU = /^\u001b\[(\d+)(?::\d*)?(?::\d*)?(?:;(\d+)(?::([123]))?)?(?:;[\d:]*)?u/u
        .exec(this.buffer);
      if (csiU) {
        const key = keyFromCodePoint(Number(csiU[1]));
        if (key) {
          const action: KeyAction = csiU[3] === "2"
            ? "repeat"
            : csiU[3] === "3"
              ? "release"
              : "press";
          events.push({
            kind: "key",
            key,
            ...modifiersFromCode(Number(csiU[2] ?? 1)),
            ...(action === "press" ? {} : { action }),
          });
        }
        this.buffer = this.buffer.slice(csiU[0].length);
        continue;
      }

      const modifyOtherKeys = /^\u001b\[27;(\d+);(\d+)~/u.exec(this.buffer);
      if (modifyOtherKeys) {
        const key = keyFromCodePoint(Number(modifyOtherKeys[2]));
        if (key) {
          events.push({
            kind: "key",
            key,
            ...modifiersFromCode(Number(modifyOtherKeys[1])),
          });
        }
        this.buffer = this.buffer.slice(modifyOtherKeys[0].length);
        continue;
      }

      const modifiedKey = /^\u001b\[(\d+);(\d+)(?::([123]))?([A-DF-HP-S~])/u
        .exec(this.buffer);
      if (modifiedKey) {
        const event = decodeModifiedKey(
          Number(modifiedKey[1]),
          Number(modifiedKey[2]),
          modifiedKey[4],
          modifiedKey[3] ? Number(modifiedKey[3]) : undefined,
        );
        if (event) events.push(event);
        this.buffer = this.buffer.slice(modifiedKey[0].length);
        continue;
      }

      if (/^\u001b\[[0-9;:?<>]*$/u.test(this.buffer)) break;

      const sequence = Object.keys(escapeSequences)
        .sort((a, b) => b.length - a.length)
        .find((candidate) => this.buffer.startsWith(candidate));
      if (sequence) {
        events.push(escapeSequences[sequence]);
        this.buffer = this.buffer.slice(sequence.length);
        continue;
      }

      if (this.buffer.startsWith("\u001b[")) {
        if (!/[A-Za-z~]/u.test(this.buffer.slice(2))) break;
        const unknown = /^\u001b\[[0-9;?<>]*[A-Za-z~]/u.exec(this.buffer)?.[0];
        this.buffer = this.buffer.slice(unknown?.length ?? 1);
        continue;
      }

      const character = [...this.buffer][0];
      if (!character) break;
      this.buffer = this.buffer.slice(character.length);
      if (character >= " " && character !== "\u007f") {
        events.push({ kind: "text", text: character });
      }
    }

    return events;
  }
}

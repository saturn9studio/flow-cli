import type { ReadStream, WriteStream } from "node:tty";
import {
  cursorColorToAnsi,
  cursorStyleToAnsi,
  diffFrames,
  type TerminalCursorStyle,
} from "./ansi.js";
import { TerminalEditor } from "./editor.js";
import type { Frame } from "./frame.js";
import { TerminalInputDecoder } from "./input.js";
import type { TerminalTheme } from "./theme.js";
import {
  deleteKittyGraphic,
  detectNativeGraphicsProtocol,
  graphicId,
  renderIterm2Graphic,
  renderKittyGraphic,
  type NativeGraphicsProtocol,
} from "./nativeGraphics.js";
import type { InputEvent } from "./input.js";

export interface TerminalSurface {
  frame(width: number, height: number): Frame;
  handleInput(
    event: InputEvent,
    viewport: { readonly width: number; readonly height: number },
  ): boolean;
  onUpdate(listener: () => void): () => void;
  destroy(): void;
}

export interface NodeTerminalHostOptions {
  readonly stdin?: ReadStream;
  readonly stdout?: WriteStream;
  readonly theme?: TerminalTheme | (() => TerminalTheme);
  readonly cursor?: TerminalCursorStyle | (() => TerminalCursorStyle);
  readonly keyboardProtocol?: "auto" | "legacy" | "kitty";
  readonly graphicsProtocol?: "auto" | "none" | NativeGraphicsProtocol;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly ctrlCExits?: boolean;
  readonly onExitRequest?: () => boolean;
  readonly onExit?: () => void;
}

export type TerminalKeyboardProtocol = "legacy" | "kitty";

export const detectTerminalKeyboardProtocol = (
  environment: Readonly<Record<string, string | undefined>>,
): TerminalKeyboardProtocol => {
  const terminal = [
    environment.TERM,
    environment.TERM_PROGRAM,
    environment.KITTY_WINDOW_ID ? "kitty" : undefined,
  ].filter(Boolean).join(" ");
  return /(kitty|wezterm|ghostty|foot)/iu.test(terminal) ? "kitty" : "legacy";
};

export class NodeTerminalHost {
  private readonly decoder = new TerminalInputDecoder();
  private readonly stdin: ReadStream;
  private readonly stdout: WriteStream;
  private previousFrame: Frame | null = null;
  private unsubscribeEditor: (() => void) | null = null;
  private active = false;
  private graphicKeys = new Map<string, number>();
  private readonly graphicDataIds = new WeakMap<Uint8Array, number>();
  private nextGraphicDataId = 0;
  private graphicsSignature = "";
  private themeSignature = "";
  private cursorColorSignature = JSON.stringify(null);
  private cursorStyleSignature = "";
  private readonly dataHandler = (chunk: Buffer | string): void => {
    for (const event of this.decoder.push(chunk.toString())) {
      if (
        event.kind === "key" &&
        event.ctrl &&
        (event.key === "q" ||
          (event.key === "c" && this.options.ctrlCExits !== false))
      ) {
        if (this.options.onExitRequest?.() === false) {
          continue;
        }
        this.stop();
        this.options.onExit?.();
        return;
      }
      this.surface.handleInput(event, this.viewport());
    }
    this.render();
  };
  private readonly resizeHandler = (): void => {
    const viewport = this.viewport();
    this.surface.handleInput({
      kind: "resize",
      columns: viewport.width,
      rows: viewport.height,
    }, viewport);
    this.previousFrame = null;
    this.graphicsSignature = "";
    this.render();
  };

  constructor(
    private readonly surface: TerminalSurface,
    private readonly options: NodeTerminalHostOptions = {},
  ) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
  }

  start(): void {
    if (this.active) return;
    if (!this.stdin.isTTY || !this.stdout.isTTY || !this.stdin.setRawMode) {
      throw new Error("The terminal host requires an interactive TTY.");
    }
    this.active = true;
    this.stdin.setRawMode(true);
    this.stdin.resume();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", this.dataHandler);
    this.stdout.on("resize", this.resizeHandler);
    const keyboardProtocol = this.keyboardProtocol();
    const cursorStyle = this.cursorStyle();
    this.cursorStyleSignature = JSON.stringify(cursorStyle);
    this.stdout.write(
      `\u001b[?1049h\u001b[?25l\u001b[?2004h\u001b[?1002h\u001b[?1006h${
        keyboardProtocol === "kitty" ? "\u001b[>1u" : ""
      }${cursorStyleToAnsi(cursorStyle)}`,
    );
    this.unsubscribeEditor = this.surface.onUpdate(() => this.render());
    this.render();
  }

  render(): void {
    if (!this.active) return;
    const viewport = this.viewport();
    const frame = this.surface.frame(viewport.width, viewport.height);
    const theme = this.theme();
    const themeSignature = JSON.stringify(theme ?? null);
    if (themeSignature !== this.themeSignature) this.previousFrame = null;
    const cursorColorSignature = JSON.stringify(theme?.cursor ?? null);
    const cursorOutput = cursorColorSignature !== this.cursorColorSignature
      ? cursorColorToAnsi(theme?.cursor)
      : "";
    const cursorStyle = this.cursorStyle();
    const cursorStyleSignature = JSON.stringify(cursorStyle);
    const cursorStyleOutput = cursorStyleSignature !== this.cursorStyleSignature
      ? cursorStyleToAnsi(cursorStyle)
      : "";
    const protocol = this.graphicsProtocol();
    const graphics = protocol ? (frame.graphics ?? []) : [];
    const signature = graphics
      .map((graphic) =>
        `${graphic.key}:${graphic.row}:${graphic.column}:${graphic.columns}:${
          graphic.rows
        }:${graphic.image.width}:${graphic.image.height}:${
          this.graphicDataId(graphic.image.data)
        }`,
      )
      .join("|");
    const graphicsChanged = signature !== this.graphicsSignature;
    const prefix = graphicsChanged && protocol === "iterm2" ? "\u001b[2J" : "";
    if (prefix) this.previousFrame = null;
    const output = diffFrames(this.previousFrame, frame, {
      theme,
    });
    let graphicOutput = "";
    if (graphicsChanged && protocol === "kitty") {
      graphicOutput += [...this.graphicKeys.values()].map(deleteKittyGraphic).join("");
      this.graphicKeys.clear();
    }
    if (graphicsChanged && protocol) {
      graphicOutput += graphics
        .map((graphic) => {
          this.graphicKeys.set(graphic.key, graphicId(graphic.key));
          return protocol === "kitty"
            ? renderKittyGraphic(graphic)
            : renderIterm2Graphic(graphic);
        })
        .join("");
      graphicOutput += `\u001b[${frame.cursor.row + 1};${frame.cursor.column + 1}H`;
    }
    if (cursorOutput || cursorStyleOutput || prefix || output || graphicOutput) {
      this.stdout.write(
        `${cursorOutput}${cursorStyleOutput}${prefix}${output}${graphicOutput}`,
      );
    }
    this.previousFrame = frame;
    this.graphicsSignature = signature;
    this.themeSignature = themeSignature;
    this.cursorColorSignature = cursorColorSignature;
    this.cursorStyleSignature = cursorStyleSignature;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.unsubscribeEditor?.();
    this.unsubscribeEditor = null;
    this.stdin.off("data", this.dataHandler);
    this.stdout.off("resize", this.resizeHandler);
    this.stdin.setRawMode?.(false);
    this.stdin.pause();
    const graphicsCleanup = this.graphicsProtocol() === "kitty"
      ? [...this.graphicKeys.values()].map(deleteKittyGraphic).join("")
      : "";
    this.graphicKeys.clear();
    this.graphicsSignature = "";
    this.themeSignature = "";
    const cursorCleanup = this.cursorColorSignature === JSON.stringify(null)
      ? ""
      : cursorColorToAnsi();
    this.cursorColorSignature = JSON.stringify(null);
    this.cursorStyleSignature = "";
    const keyboardProtocol = this.keyboardProtocol();
    this.stdout.write(
      `${graphicsCleanup}${cursorCleanup}\u001b[0m${
        keyboardProtocol === "kitty" ? "\u001b[<u" : ""
      }\u001b[?1006l\u001b[?1002l\u001b[?2004l${cursorStyleToAnsi()}\u001b[?25h\u001b[?1049l`,
    );
    this.surface.destroy();
  }

  private viewport(): { width: number; height: number } {
    return {
      width: Math.max(20, this.stdout.columns ?? 80),
      height: Math.max(1, this.stdout.rows ?? 24),
    };
  }

  private graphicsProtocol(): NativeGraphicsProtocol | undefined {
    if (this.options.graphicsProtocol === "none") return undefined;
    if (
      this.options.graphicsProtocol === "kitty" ||
      this.options.graphicsProtocol === "iterm2"
    ) {
      return this.options.graphicsProtocol;
    }

    return detectNativeGraphicsProtocol(this.options.environment ?? process.env);
  }

  private keyboardProtocol(): TerminalKeyboardProtocol {
    if (
      this.options.keyboardProtocol === undefined ||
      this.options.keyboardProtocol === "legacy"
    ) {
      return "legacy";
    }
    return this.options.keyboardProtocol === "auto"
      ? detectTerminalKeyboardProtocol(this.options.environment ?? process.env)
      : this.options.keyboardProtocol;
  }

  private theme(): TerminalTheme | undefined {
    return typeof this.options.theme === "function"
      ? this.options.theme()
      : this.options.theme;
  }

  private cursorStyle(): TerminalCursorStyle {
    return typeof this.options.cursor === "function"
      ? this.options.cursor()
      : this.options.cursor ?? { shape: "default" };
  }

  private graphicDataId(data: Uint8Array): number {
    const existing = this.graphicDataIds.get(data);
    if (existing !== undefined) return existing;
    const id = ++this.nextGraphicDataId;
    this.graphicDataIds.set(data, id);
    return id;
  }
}

export const runInTerminal = (
  editor: TerminalEditor,
  options?: NodeTerminalHostOptions,
): NodeTerminalHost => {
  const host = new NodeTerminalHost(editor, options);
  host.start();
  return host;
};

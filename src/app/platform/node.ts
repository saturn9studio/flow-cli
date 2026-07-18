import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AssetService,
  ClipboardService,
  DirectoryEntry,
  FileService,
  FileVersion,
  FlowCliPlatform,
  OpenedTextFile,
  SystemService,
  RecoveryService,
  RecoverySnapshot,
  SettingsService,
  TimerService,
} from "./types.js";
import {
  defaultFlowCliSettings,
  normalizeFlowCliSettings,
  type FlowCliSettings,
} from "../settings.js";

const versionFromStat = (
  value: { readonly mtimeMs: number; readonly size: number },
): FileVersion => ({
  modifiedAtMs: value.mtimeMs,
  size: value.size,
});

const missingFile = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error as NodeJS.ErrnoException).code === "ENOENT";

export class NodeFileService implements FileService {
  constructor(
    private readonly draftDirectory = process.cwd(),
  ) {}

  async read(filePath: string): Promise<OpenedTextFile | null> {
    try {
      const [content, metadata] = await Promise.all([
        readFile(filePath, "utf8"),
        stat(filePath),
      ]);
      return { content, version: versionFromStat(metadata) };
    } catch (error) {
      if (missingFile(error)) return null;
      throw error;
    }
  }

  async version(filePath: string): Promise<FileVersion | null> {
    try {
      return versionFromStat(await stat(filePath));
    } catch (error) {
      if (missingFile(error)) return null;
      throw error;
    }
  }

  async writeAtomic(filePath: string, content: string): Promise<FileVersion> {
    const existing = await this.statIfPresent(filePath);
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(
      directory,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
    );
    const handle = await open(temporaryPath, "wx", existing?.mode ?? 0o666);
    try {
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (existing) await chmod(temporaryPath, existing.mode);
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    return versionFromStat(await stat(filePath));
  }

  async suggestUntitledPath(): Promise<string> {
    for (let index = 1; ; index += 1) {
      const suffix = index === 1 ? "" : ` ${index}`;
      const candidate = path.join(
        this.draftDirectory,
        `Untitled${suffix}.md`,
      );
      if ((await this.version(candidate)) === null) return candidate;
    }
  }

  async readDirectory(directoryPath: string): Promise<readonly DirectoryEntry[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const resolved = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      let kind: DirectoryEntry["kind"] | undefined;
      if (entry.isDirectory()) kind = "directory";
      else if (entry.isFile()) kind = "file";
      else if (entry.isSymbolicLink()) {
        try {
          const metadata = await stat(entryPath);
          if (metadata.isDirectory()) kind = "directory";
          else if (metadata.isFile()) kind = "file";
        } catch (error) {
          if (!missingFile(error)) throw error;
        }
      }
      return kind ? { name: entry.name, path: entryPath, kind } : null;
    }));
    return resolved.filter(
      (entry): entry is DirectoryEntry => entry !== null,
    );
  }

  private async statIfPresent(
    filePath: string,
  ): Promise<{ readonly mode: number } | null> {
    try {
      const metadata = await stat(filePath);
      return { mode: metadata.mode };
    } catch (error) {
      if (missingFile(error)) return null;
      throw error;
    }
  }
}

const runCommand = (
  command: string,
  arguments_: readonly string[],
  input?: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...arguments_], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });

export class NodeClipboardService implements ClipboardService {
  async readText(): Promise<string> {
    if (process.platform === "darwin") return runCommand("pbpaste", []);
    if (process.platform === "win32") {
      return runCommand("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Clipboard -Raw",
      ]);
    }
    return process.env.WAYLAND_DISPLAY
      ? runCommand("wl-paste", ["--no-newline"])
      : runCommand("xclip", ["-selection", "clipboard", "-out"]);
  }

  async writeText(text: string): Promise<void> {
    if (process.platform === "darwin") {
      await runCommand("pbcopy", [], text);
    } else if (process.platform === "win32") {
      await runCommand("clip.exe", [], text);
    } else if (process.env.WAYLAND_DISPLAY) {
      await runCommand("wl-copy", [], text);
    } else {
      await runCommand("xclip", ["-selection", "clipboard", "-in"], text);
    }
  }
}

const localImagePath = (
  source: string,
  documentPath: string,
): string => {
  if (source.startsWith("file:")) return fileURLToPath(source);
  if (source === "~") return homedir();
  if (source.startsWith("~/")) return path.resolve(homedir(), source.slice(2));
  return path.isAbsolute(source)
    ? source
    : path.resolve(path.dirname(documentPath), source);
};

export class NodeAssetService implements AssetService {
  async readImage(source: string, documentPath: string): Promise<Uint8Array> {
    if (/^https?:/iu.test(source)) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`Image request failed with status ${response.status}.`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    if (
      /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(source) &&
      !source.startsWith("file:") &&
      !path.win32.isAbsolute(source)
    ) {
      throw new Error(`Unsupported image source: ${source}`);
    }
    return readFile(localImagePath(source, documentPath));
  }
}

export class NodeSystemService implements SystemService {
  async openUrl(url: string): Promise<void> {
    if (!/^(https?|mailto|tel):/iu.test(url)) {
      throw new Error(`Unsupported external URL: ${url}`);
    }
    if (process.platform === "darwin") {
      await runCommand("open", [url]);
    } else if (process.platform === "win32") {
      await runCommand("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
    } else {
      await runCommand("xdg-open", [url]);
    }
  }
}

const defaultConfigDirectory = (): string => {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Flow");
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "Flow");
  }
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
    "flow",
  );
};

const readJson = async (filePath: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (missingFile(error)) return null;
    throw new Error(`Could not read ${filePath}: ${errorMessage(error)}`);
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await new NodeFileService().writeAtomic(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
};

export class NodeSettingsService implements SettingsService {
  constructor(
    private readonly filePath = path.join(defaultConfigDirectory(), "settings.json"),
  ) {}

  async load(): Promise<FlowCliSettings> {
    const stored = await readJson(this.filePath);
    return stored === null
      ? defaultFlowCliSettings
      : normalizeFlowCliSettings(stored);
  }

  async save(settings: FlowCliSettings): Promise<void> {
    await writeJson(this.filePath, settings);
  }
}

export class NodeRecoveryService implements RecoveryService {
  constructor(
    private readonly directory = path.join(defaultConfigDirectory(), "recovery"),
  ) {}

  async load(documentPath: string): Promise<RecoverySnapshot | null> {
    const value = await readJson(this.snapshotPath(documentPath));
    if (
      !value ||
      typeof value !== "object" ||
      !("documentPath" in value) ||
      !("content" in value) ||
      !("savedAt" in value) ||
      typeof value.documentPath !== "string" ||
      typeof value.content !== "string" ||
      typeof value.savedAt !== "string"
    ) {
      return null;
    }
    return {
      documentPath: value.documentPath,
      content: value.content,
      savedAt: value.savedAt,
    };
  }

  async save(snapshot: RecoverySnapshot): Promise<void> {
    await writeJson(this.snapshotPath(snapshot.documentPath), snapshot);
  }

  async clear(documentPath: string): Promise<void> {
    await rm(this.snapshotPath(documentPath), { force: true });
  }

  private snapshotPath(documentPath: string): string {
    const key = createHash("sha256").update(documentPath).digest("hex");
    return path.join(this.directory, `${key}.json`);
  }
}

export const nodeTimerService: TimerService = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export const createNodePlatform = (): FlowCliPlatform => ({
  files: new NodeFileService(),
  clipboard: new NodeClipboardService(),
  assets: new NodeAssetService(),
  system: new NodeSystemService(),
  settings: new NodeSettingsService(),
  recovery: new NodeRecoveryService(),
  timers: nodeTimerService,
  cwd: process.cwd(),
  homeDirectory: homedir(),
  resolvePath: (input) => resolveUserPath(input, process.cwd(), homedir()),
  directoryName: (filePath) => path.dirname(filePath),
});

export const resolveUserPath = (
  input: string,
  cwd: string,
  homeDirectory: string,
): string => {
  const expanded = input === "~"
    ? homeDirectory
    : input.startsWith("~/")
      ? path.join(homeDirectory, input.slice(2))
      : input;
  return path.resolve(cwd, expanded);
};

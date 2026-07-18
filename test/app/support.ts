import type {
  DirectoryEntry,
  FileService,
  FileVersion,
  OpenedTextFile,
  FlowCliPlatform,
} from "../../src/app/platform/types.js";
import path from "node:path";
import {
  defaultFlowCliSettings,
  type FlowCliSettings,
} from "../../src/app/settings.js";

interface Entry {
  content: string;
  version: FileVersion;
}

export const createTestPlatform = (
  files: MemoryFileService,
  clipboardText = "",
): FlowCliPlatform & {
  readonly clipboardWrites: string[];
  readonly openedUrls: string[];
  readonly savedSettings: FlowCliSettings[];
  runTimers(): void;
  recoveryFor(path: string): {
    readonly documentPath: string;
    readonly content: string;
    readonly savedAt: string;
  } | null;
} => {
  let currentClipboard = clipboardText;
  const clipboardWrites: string[] = [];
  const openedUrls: string[] = [];
  const savedSettings: FlowCliSettings[] = [];
  const recoveries = new Map<string, {
    documentPath: string;
    content: string;
    savedAt: string;
  }>();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  return {
    files,
    cwd: "/",
    homeDirectory: "/Users/test",
    resolvePath: (input) => input.startsWith("/") ? input : `/${input}`,
    directoryName: (filePath) => path.posix.dirname(filePath),
    clipboardWrites,
    openedUrls,
    savedSettings,
    runTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    recoveryFor: (path) => recoveries.get(path) ?? null,
    clipboard: {
      readText: async () => currentClipboard,
      writeText: async (text) => {
        currentClipboard = text;
        clipboardWrites.push(text);
      },
    },
    assets: {
      readImage: async () => Uint8Array.from([]),
    },
    system: {
      openUrl: async (url) => {
        openedUrls.push(url);
      },
    },
    settings: {
      load: async () => defaultFlowCliSettings,
      save: async (settings) => {
        savedSettings.push(settings);
      },
    },
    recovery: {
      load: async (path) => recoveries.get(path) ?? null,
      save: async (snapshot) => {
        recoveries.set(snapshot.documentPath, snapshot);
      },
      clear: async (path) => {
        recoveries.delete(path);
      },
    },
    timers: {
      setTimeout: (callback) => {
        const id = ++timerId;
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number);
      },
    },
  };
};

export class MemoryFileService implements FileService {
  readonly writes: { readonly path: string; readonly content: string }[] = [];
  private readonly entries = new Map<string, Entry>();
  private clock = 1;

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.setExternal(path, content);
    }
  }

  async read(path: string): Promise<OpenedTextFile | null> {
    const entry = this.entries.get(path);
    return entry
      ? { content: entry.content, version: { ...entry.version } }
      : null;
  }

  async version(path: string): Promise<FileVersion | null> {
    const version = this.entries.get(path)?.version;
    return version ? { ...version } : null;
  }

  async writeAtomic(path: string, content: string): Promise<FileVersion> {
    this.writes.push({ path, content });
    this.setExternal(path, content);
    return { ...(this.entries.get(path)?.version as FileVersion) };
  }

  async suggestUntitledPath(): Promise<string> {
    return "/Documents/Untitled.md";
  }

  async readDirectory(directoryPath: string): Promise<readonly DirectoryEntry[]> {
    const prefix = directoryPath === "/" ? "/" : `${directoryPath.replace(/\/+$/u, "")}/`;
    const children = new Map<string, DirectoryEntry>();
    for (const entryPath of this.entries.keys()) {
      if (!entryPath.startsWith(prefix)) continue;
      const remainder = entryPath.slice(prefix.length);
      const [name, ...rest] = remainder.split("/");
      if (!name) continue;
      const kind = rest.length > 0 ? "directory" : "file";
      children.set(name, {
        name,
        path: path.posix.join(directoryPath, name),
        kind,
      });
    }
    return [...children.values()];
  }

  setExternal(path: string, content: string): void {
    this.entries.set(path, {
      content,
      version: { modifiedAtMs: this.clock++, size: content.length },
    });
  }
}

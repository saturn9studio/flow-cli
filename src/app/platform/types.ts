export interface FileVersion {
  readonly modifiedAtMs: number;
  readonly size: number;
}

export interface OpenedTextFile {
  readonly content: string;
  readonly version: FileVersion;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: "directory" | "file";
}

export interface FileService {
  read(path: string): Promise<OpenedTextFile | null>;
  version(path: string): Promise<FileVersion | null>;
  writeAtomic(path: string, content: string): Promise<FileVersion>;
  suggestUntitledPath(): Promise<string>;
  readDirectory(path: string): Promise<readonly DirectoryEntry[]>;
}

export interface ClipboardService {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

export interface AssetService {
  readImage(source: string, documentPath: string): Promise<Uint8Array>;
}

export interface SystemService {
  openUrl(url: string): Promise<void>;
}

export interface RecoverySnapshot {
  readonly documentPath: string;
  readonly content: string;
  readonly savedAt: string;
}

export interface SettingsService {
  load(): Promise<FlowCliSettings>;
  save(settings: FlowCliSettings): Promise<void>;
}

export interface RecoveryService {
  load(documentPath: string): Promise<RecoverySnapshot | null>;
  save(snapshot: RecoverySnapshot): Promise<void>;
  clear(documentPath: string): Promise<void>;
}

export interface TimerService {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FlowCliPlatform {
  readonly files: FileService;
  readonly clipboard: ClipboardService;
  readonly assets: AssetService;
  readonly system: SystemService;
  readonly settings: SettingsService;
  readonly recovery: RecoveryService;
  readonly timers: TimerService;
  readonly cwd: string;
  readonly homeDirectory: string;
  resolvePath(input: string): string;
  directoryName(path: string): string;
}
import type { FlowCliSettings } from "../settings.js";

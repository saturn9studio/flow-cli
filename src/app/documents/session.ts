import path from "node:path";
import type { FileService, FileVersion } from "../platform/types.js";

const sameVersion = (
  left: FileVersion | null,
  right: FileVersion | null,
): boolean =>
  left === null || right === null
    ? left === right
    : left.modifiedAtMs === right.modifiedAtMs && left.size === right.size;

export class ExternalDocumentChangeError extends Error {
  constructor(readonly path: string) {
    super(`The file changed outside Flow: ${path}`);
  }
}

export class DocumentSession {
  private savedContent: string;

  constructor(
    private readonly files: FileService,
    private filePath: string,
    private currentContent: string,
    private savedVersion: FileVersion | null,
    private temporary: boolean,
  ) {
    this.savedContent = currentContent;
  }

  get path(): string {
    return this.filePath;
  }

  get displayName(): string {
    return path.basename(this.filePath);
  }

  get content(): string {
    return this.currentContent;
  }

  get isDirty(): boolean {
    return this.currentContent !== this.savedContent;
  }

  get isTemporary(): boolean {
    return this.temporary;
  }

  updateContent(content: string): void {
    this.currentContent = content;
  }

  async save(force = false): Promise<void> {
    const currentVersion = await this.files.version(this.filePath);
    if (!force && !sameVersion(currentVersion, this.savedVersion)) {
      throw new ExternalDocumentChangeError(this.filePath);
    }
    this.savedVersion = await this.files.writeAtomic(
      this.filePath,
      this.currentContent,
    );
    this.savedContent = this.currentContent;
    this.temporary = false;
  }

  async saveAs(filePath: string, force = false): Promise<void> {
    if (filePath === this.filePath) {
      await this.save(force);
      return;
    }
    const currentVersion = await this.files.version(filePath);
    if (!force && currentVersion !== null) {
      throw new ExternalDocumentChangeError(filePath);
    }
    this.savedVersion = await this.files.writeAtomic(
      filePath,
      this.currentContent,
    );
    this.filePath = filePath;
    this.savedContent = this.currentContent;
    this.temporary = false;
  }

  async reload(): Promise<void> {
    const opened = await this.files.read(this.filePath);
    if (!opened) {
      throw new Error(`The file no longer exists: ${this.filePath}`);
    }
    this.currentContent = opened.content;
    this.savedContent = opened.content;
    this.savedVersion = opened.version;
    this.temporary = false;
  }
}

export const openDocumentSession = async (
  files: FileService,
  filePath?: string,
): Promise<DocumentSession> => {
  const resolvedPath = filePath ?? await files.suggestUntitledPath();
  const opened = filePath ? await files.read(resolvedPath) : null;
  return new DocumentSession(
    files,
    resolvedPath,
    opened?.content ?? "",
    opened?.version ?? null,
    filePath === undefined,
  );
};

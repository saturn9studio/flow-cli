import { describe, expect, it } from "vitest";
import {
  ExternalDocumentChangeError,
  openDocumentSession,
} from "../../src/app/documents/session.js";
import { MemoryFileService } from "./support.js";

describe("FlowCLI document session", () => {
  it("opens, tracks, and atomically saves a document", async () => {
    const files = new MemoryFileService({ "/draft.md": "Original" });
    const document = await openDocumentSession(files, "/draft.md");

    expect(document.content).toBe("Original");
    expect(document.isDirty).toBe(false);
    document.updateContent("Changed");
    expect(document.isDirty).toBe(true);

    await document.save();

    expect(document.isDirty).toBe(false);
    expect(files.writes).toEqual([
      { path: "/draft.md", content: "Changed" },
    ]);
  });

  it("does not overwrite an external change without confirmation", async () => {
    const files = new MemoryFileService({ "/draft.md": "Original" });
    const document = await openDocumentSession(files, "/draft.md");
    document.updateContent("Local");
    files.setExternal("/draft.md", "External");

    await expect(document.save()).rejects.toBeInstanceOf(
      ExternalDocumentChangeError,
    );
    expect(files.writes).toHaveLength(0);

    await document.save(true);
    expect(files.writes[0]?.content).toBe("Local");
  });

  it("creates an untitled identity without writing an empty file", async () => {
    const files = new MemoryFileService();
    const document = await openDocumentSession(files);

    expect(document.path).toBe("/Documents/Untitled.md");
    expect(document.isTemporary).toBe(true);
    expect(files.writes).toHaveLength(0);

    document.updateContent("Draft");
    await document.save();
    expect(document.isTemporary).toBe(false);
  });

  it("changes document identity only after Save As succeeds", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const document = await openDocumentSession(files, "/draft.md");
    document.updateContent("Changed");

    await document.saveAs("/renamed.md");

    expect(document.path).toBe("/renamed.md");
    expect(document.displayName).toBe("renamed.md");
    expect(files.writes.at(-1)).toEqual({
      path: "/renamed.md",
      content: "Changed",
    });
  });
});

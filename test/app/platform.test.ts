import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NodeAssetService,
  NodeFileService,
} from "../../src/app/platform/node.js";

describe("FlowCLI Node platform", () => {
  it("treats Windows drive-letter image sources as paths, not URL schemes", async () => {
    const assets = new NodeAssetService();
    let message = "";
    try {
      await assets.readImage("C:\\missing\\image.png", "/draft.md");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain("Unsupported image source");
  });

  it("lists regular files and directories for the Open browser", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "flowcli-browser-"));
    try {
      await mkdir(path.join(directory, "archive"));
      await writeFile(path.join(directory, "draft.md"), "Draft");
      await writeFile(path.join(directory, "notes.txt"), "Notes");

      await expect(new NodeFileService().readDirectory(directory)).resolves
        .toEqual(expect.arrayContaining([
          {
            name: "archive",
            path: path.join(directory, "archive"),
            kind: "directory",
          },
          {
            name: "draft.md",
            path: path.join(directory, "draft.md"),
            kind: "file",
          },
          {
            name: "notes.txt",
            path: path.join(directory, "notes.txt"),
            kind: "file",
          },
        ]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("suggests untitled drafts in the configured launch directory", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "flowcli-drafts-"));
    try {
      await writeFile(path.join(directory, "Untitled.md"), "Existing");

      await expect(new NodeFileService(directory).suggestUntitledPath()).resolves
        .toBe(path.join(directory, "Untitled 2.md"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

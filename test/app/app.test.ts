import { describe, expect, it, vi } from "vitest";
import { terminalImageFromRgba } from "../../src/markdown/index.js";
import {
  createFlowCliImageRenderer,
  FlowCliApp,
} from "../../src/app/app.js";
import { openDocumentSession } from "../../src/app/documents/session.js";
import { createTestPlatform, MemoryFileService } from "./support.js";
import { defaultFlowCliSettings } from "../../src/app/settings.js";

const viewport = { width: 80, height: 24 };

const frameText = (app: FlowCliApp): string =>
  app.frame(viewport.width, viewport.height).rows
    .map((row) => row.cells.map((cell) => cell.text).join(""))
    .join("\n");

describe("FlowCLI application surface", () => {
  it("composites image fallback alpha against the editor background", () => {
    let background = {
      red: 255,
      green: 255,
      blue: 255,
    };
    const renderer = createFlowCliImageRenderer(() => background);
    const image = terminalImageFromRgba(
      1,
      1,
      Uint8Array.from([255, 0, 0, 128]),
    );

    const rendered = renderer.render({
      props: {
        image,
        alt: "transparent",
        src: "transparent.png",
      },
      sourceText: "![transparent](transparent.png)",
      width: 1,
      readOnly: false,
      focused: false,
    });

    expect(rendered.lines[0]?.[0]).toEqual({
      text: "█",
      style: {
        foreground: { red: 255, green: 127, blue: 127 },
      },
    });
    expect(rendered.graphic?.data).toEqual(image.rgba);

    background = { red: 0, green: 0, blue: 0 };
    expect(renderer.render({
      props: {
        image,
        alt: "transparent",
        src: "transparent.png",
      },
      sourceText: "![transparent](transparent.png)",
      width: 1,
      readOnly: false,
      focused: false,
    }).lines[0]?.[0]?.style.foreground).toEqual({
      red: 128,
      green: 0,
      blue: 0,
    });
  });

  it("keeps the rendered cursor on the empty line created by Enter", async () => {
    const files = new MemoryFileService({ "/draft.md": "" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );
    app.handleInput({ kind: "text", text: "abc" }, viewport);

    app.handleInput({ kind: "key", key: "Enter" }, viewport);

    expect(app.frame(viewport.width, viewport.height).cursor).toEqual({
      row: 3,
      column: 1,
      visible: true,
    });
    app.destroy();
  });

  it("preserves literal Markdown newlines for paragraph authoring", async () => {
    const files = new MemoryFileService({ "/draft.md": "" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "text", text: "first" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "text", text: "second" }, viewport);
    expect(app.document.content).toBe("first\nsecond");

    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "text", text: "third" }, viewport);
    expect(app.document.content).toBe("first\nsecond\n\nthird");
    app.destroy();
  });

  it("composes editor state and document state into a status row", async () => {
    const files = new MemoryFileService({ "/draft.md": "one two" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    expect(frameText(app)).toContain("F3 Edit");
    expect(app.frame(viewport.width, viewport.height).rows.at(-1)?.cells
      .filter((cell) => cell.style.role === "flowStatusActive")
      .map((cell) => cell.text).join("")).toBe(" F3 Edit ");
    expect(frameText(app)).toContain("F10 Menu");
    expect(frameText(app)).not.toContain("^S Save");
    expect(frameText(app)).toContain("2 words");
    expect(frameText(app)).not.toContain("Ln ");
    expect(frameText(app)).not.toContain("Col ");

    app.handleInput({ kind: "key", key: "a", ctrl: true }, viewport);
    expect(frameText(app)).toContain("[2 words]");
    app.handleInput({ kind: "key", key: "ArrowLeft" }, viewport);
    expect(frameText(app)).toContain("2 words");
    expect(frameText(app)).not.toContain("[2 words]");

    app.handleInput({ kind: "text", text: "New " }, viewport);
    expect(app.document.isDirty).toBe(true);

    await app.save();
    expect(app.document.isDirty).toBe(false);
    expect(files.writes[0]?.content).toBe("New one two");
    app.destroy();
  });

  it("switches modes from the status bar with the mouse", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );
    const status = app.frame(viewport.width, viewport.height).rows.at(-1)!
      .cells.map((cell) => cell.text).join("");
    const readColumn = status.indexOf("F4 Read") + 1;

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: viewport.height - 1,
      column: readColumn,
    }, viewport);
    await app.whenIdle();

    expect(app.activeMode).toBe("read");
    expect(platform.savedSettings).toEqual([]);
    expect(frameText(app)).toContain("F4 Read");
    app.destroy();
  });

  it("starts each session in Edit mode and ignores legacy persisted modes", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const legacySettings = {
      ...defaultFlowCliSettings,
      mode: "source",
    } as const;
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      legacySettings,
    );

    expect(app.activeMode).toBe("edit");
    expect(frameText(app)).toContain("F3 Edit");
    app.destroy();
  });

  it("requires an explicit choice before discarding dirty work", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );
    const exit = vi.fn();
    app.setExitHandler(exit);
    app.handleInput({ kind: "text", text: "x" }, viewport);

    expect(app.requestExit()).toBe(false);
    expect(frameText(app)).toContain("Unsaved changes");
    app.handleInput({ kind: "key", key: "n" }, viewport);
    expect(exit).toHaveBeenCalledOnce();
    app.destroy();
  });

  it("offers overwrite or reload when the file changed externally", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );
    app.handleInput({ kind: "text", text: "Local " }, viewport);
    files.setExternal("/draft.md", "External");

    await app.save();

    expect(frameText(app)).toContain("File changed on disk");
    app.handleInput({ kind: "key", key: "r" }, viewport);
    await app.whenIdle();
    expect(frameText(app)).toContain("Reloaded draft.md");
    expect(frameText(app)).not.toContain("draft.md*");
    app.destroy();
  });

  it("switches modes and runs formatting commands through the palette", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: "p", ctrl: true }, viewport);
    app.handleInput({ kind: "text", text: "Mode: Read" }, viewport);
    expect(frameText(app)).toContain("Mode: Read");
    app.handleInput({ kind: "key", key: "Enter" }, viewport);

    expect(app.activeMode).toBe("read");
    expect(frameText(app)).toContain("F4 Read");
    app.destroy();
  });

  it("projects main-menu order into the command palette", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.showPalette();
    app.handleInput({ kind: "text", text: "Mode:" }, viewport);
    const palette = frameText(app);

    expect(palette.indexOf("Mode: Focus")).toBeLessThan(
      palette.indexOf("Mode: Edit"),
    );
    expect(palette.indexOf("Mode: Edit")).toBeLessThan(
      palette.indexOf("Mode: Read"),
    );
    expect(palette.indexOf("Mode: Read")).toBeLessThan(
      palette.indexOf("Mode: Source"),
    );
    app.destroy();
  });

  it("collects replacement text before running Replace", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.showReplace();
    app.handleInput({ kind: "text", text: "Draft" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);

    const replacementPrompt = ' Replace "Draft" with: ';
    const replacementFrame = app.frame(viewport.width, viewport.height);
    expect(frameText(app)).toContain(
      `${replacementPrompt}  [Enter current, Ctrl+A all]`,
    );
    expect(replacementFrame.cursor.column).toBe(replacementPrompt.length);
    expect(app.document.content).toBe("Draft Draft");

    app.handleInput({ kind: "text", text: "Final" }, viewport);
    expect(frameText(app)).toContain(
      ' Replace "Draft" with: Final  [Enter current, Ctrl+A all]',
    );
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    expect(app.document.content).toBe("Final Draft");
    app.destroy();
  });

  it("previews, cancels, and persists Flow themes through Settings", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: ",", ctrl: true }, viewport);
    expect(frameText(app)).toContain("Settings");
    expect(frameText(app)).toContain("Basic Light");
    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    expect(app.terminalTheme.name).toBe("Basic Dark");
    app.handleInput({ kind: "key", key: "Escape" }, viewport);
    expect(app.terminalTheme.name).toBe("Basic Light");
    expect(platform.savedSettings).toEqual([]);

    app.handleInput({ kind: "key", key: ",", ctrl: true }, viewport);
    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.showSettings();
    expect(frameText(app)).toContain("Settings are still saving");
    expect(frameText(app)).not.toContain("Tab section");
    await app.whenIdle();

    expect(app.terminalTheme.name).toBe("Basic Dark");
    expect(platform.savedSettings.at(-1)?.theme).toBe("default-dark-theme");
    expect(frameText(app)).not.toContain("Tab section");
    app.destroy();
  });

  it("applies a theme selected with the mouse", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );
    app.showSettings();
    const frame = app.frame(viewport.width, viewport.height);
    const latteRow = frame.rows.findIndex((row) =>
      row.cells.map((cell) => cell.text).join("").includes("Latte")
    );

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: latteRow,
      column: 5,
    }, viewport);
    await app.whenIdle();

    expect(app.terminalTheme.name).toBe("Latte");
    expect(platform.savedSettings.at(-1)?.theme).toBe("latte-theme");
    app.destroy();
  });

  it("keeps the selected theme visible in a short terminal", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );
    const shortViewport = { width: 80, height: 6 };
    app.showSettings();

    for (let index = 0; index < 5; index += 1) {
      app.handleInput({ kind: "key", key: "ArrowDown" }, shortViewport);
    }

    expect(
      app.frame(shortViewport.width, shortViewport.height).rows
        .map((row) => row.cells.map((cell) => cell.text).join(""))
        .join("\n"),
    ).toContain("Solarized Dark");
    app.destroy();
  });

  it("previews, cancels, and persists cursor settings", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );
    const previewCursor = () => {
      app.handleInput({ kind: "key", key: "Tab" }, viewport);
      expect(app.terminalTheme.name).toBe("Basic Light");
      expect(frameText(app)).toContain("Cursor shape");
      expect(frameText(app)).not.toContain("Basic Dark");
      app.handleInput({ kind: "key", key: "End" }, viewport);
      app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
      app.handleInput({ kind: "key", key: "ArrowUp" }, viewport);
      app.handleInput({ kind: "key", key: "ArrowLeft" }, viewport);
    };

    app.showSettings();
    const themesFrame = app.frame(viewport.width, viewport.height);
    expect(themesFrame.rows).toHaveLength(viewport.height);
    const themesStatus = themesFrame.rows.at(-1)?.cells
      .map((cell) => cell.text)
      .join("");
    app.handleInput({ kind: "key", key: "Tab" }, viewport);
    const editorFrame = app.frame(viewport.width, viewport.height);
    expect(editorFrame.rows).toHaveLength(viewport.height);
    expect(editorFrame.rows.at(-1)?.cells.map((cell) => cell.text).join(""))
      .toBe(themesStatus);
    app.handleInput({ kind: "key", key: "Tab" }, viewport);
    previewCursor();
    expect(app.terminalCursorStyle).toEqual({
      shape: "bar",
      blinking: false,
    });
    app.handleInput({ kind: "key", key: "Escape" }, viewport);
    expect(app.terminalCursorStyle).toEqual({
      shape: "block",
      blinking: true,
    });

    app.showSettings();
    previewCursor();
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    await app.whenIdle();

    expect(platform.savedSettings.at(-1)?.cursor).toEqual({
      shape: "bar",
      blinking: false,
    });
    app.destroy();
  });

  it("restores a theme preview before showing the exit prompt", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );
    app.handleInput({ kind: "text", text: "x" }, viewport);
    app.showSettings();
    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);

    app.handleInput({ kind: "key", key: "q", ctrl: true }, viewport);
    app.handleInput({ kind: "key", key: "Escape" }, viewport);

    expect(app.terminalTheme.name).toBe("Basic Light");
    app.destroy();
  });

  it("restores the previous theme when settings persistence fails", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const platform = createTestPlatform(files);
    platform.settings.save = async () => {
      throw new Error("disk full");
    };
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );
    app.showSettings();
    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);

    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    await app.whenIdle();

    expect(app.terminalTheme.name).toBe("Basic Light");
    expect(frameText(app)).toContain("Settings failed: disk full");
    app.destroy();
  });

  it("opens a Flow-shaped menu bar and executes its commands", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    expect(app.frame(viewport.width, viewport.height).rows[0]?.cells
      .map((cell) => cell.text).join(""))
      .toContain("File  Edit  View  Insert  Format  Help");

    app.handleInput({ kind: "key", key: "F10" }, viewport);
    const menuFrame = app.frame(viewport.width, viewport.height);
    const menuLines = menuFrame.rows.map((row) =>
      row.cells.map((cell) => cell.text).join("")
    );
    expect(menuLines.some((line) => /│ Save\s+Ctrl\+S/u.test(line))).toBe(false);
    expect(menuLines.some((line) => line.includes("Save As..."))).toBe(true);
    expect(menuLines[1]?.indexOf("┐")).toBe(
      menuLines[2]?.lastIndexOf("│"),
    );
    expect(frameText(app)).toContain("Settings...");
    app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
    app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
    app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
    expect(frameText(app)).toContain("Table");
    expect(frameText(app)).toContain("Math Block");
    expect(frameText(app)).toContain("Horizontal Rule");
    expect(frameText(app)).not.toContain("∵ Separator");
    expect(frameText(app)).not.toContain("├");
    app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
    expect(frameText(app)).toContain("Math");
    app.handleInput({ kind: "key", key: "ArrowLeft" }, viewport);
    app.handleInput({ kind: "key", key: "ArrowLeft" }, viewport);
    expect(frameText(app)).toContain("Mode: Focus");
    app.handleInput({ kind: "key", key: "Enter" }, viewport);

    expect(app.activeMode).toBe("focus");
    expect(frameText(app)).not.toContain("F2 Focus");
    app.destroy();
  });

  it("inserts and presents tables from the command palette", async () => {
    const files = new MemoryFileService({ "/draft.md": "" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.showPalette();
    app.handleInput({ kind: "text", text: "Table" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    expect(app.document.content).toBe([
      "| Header 1 | Header 2 | Header 3 |",
      "| --- | --- | --- |",
      "|  |  |  |",
    ].join("\n"));

    app.handleInput({ kind: "key", key: "F4" }, viewport);
    const tableFrame = app.frame(viewport.width, viewport.height);
    const tableCells = tableFrame.rows.flatMap((row) => row.cells);
    expect(frameText(app)).toContain("┌");
    expect(frameText(app)).toContain("┼");
    expect(frameText(app)).toContain("┘");
    expect(tableCells.some((cell) => cell.style.role === "tableBorder")).toBe(true);
    expect(tableCells.some((cell) => cell.style.role === "tableHeader")).toBe(true);
    expect(tableCells.some((cell) => cell.style.role === "tableCell")).toBe(true);
    app.destroy();
  });

  it("mutes disabled menu items and skips them during navigation", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );
    app.handleInput({ kind: "text", text: "!" }, viewport);
    app.handleInput({ kind: "key", key: "F10" }, viewport);
    app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);

    const initialMenu = app.frame(viewport.width, viewport.height);
    const redoRow = initialMenu.rows.find((row) =>
      row.cells.map((cell) => cell.text).join("").includes("Redo")
    );
    expect(redoRow?.cells.some(
      (cell) => cell.style.role === "flowMenuDisabled",
    )).toBe(true);
    expect(redoRow?.cells.map((cell) => cell.text).join("")).not.toContain("×");

    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    const selectedText = app.frame(viewport.width, viewport.height).rows
      .flatMap((row) => row.cells)
      .filter((cell) => cell.style.role === "flowMenuSelected")
      .map((cell) => cell.text)
      .join("");
    expect(selectedText).toContain("Cut");
    expect(selectedText).not.toContain("Redo");
    app.destroy();
  });

  it("shows Flow CLI About details and opens its website", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: "F10" }, viewport);
    for (let index = 0; index < 5; index += 1) {
      app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
    }
    expect(frameText(app)).toContain("About Flow CLI");
    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);

    const aboutFrame = app.frame(viewport.width, viewport.height);
    expect(frameText(app)).toContain("Flow CLI");
    expect(frameText(app)).toContain("https://saturn9.studio/");
    expect(frameText(app)).not.toContain("Built on Flow CLI");
    const linkRow = aboutFrame.rows.findIndex((row) =>
      row.cells.some((cell) => cell.style.role === "markdownLink")
    );
    const linkColumn = aboutFrame.rows[linkRow]?.cells.findIndex((cell) =>
      cell.style.role === "markdownLink"
    ) ?? -1;
    expect(linkRow).toBeGreaterThanOrEqual(0);
    expect(linkColumn).toBeGreaterThanOrEqual(0);

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: linkRow,
      column: linkColumn,
    }, viewport);
    await app.whenIdle();
    expect(platform.openedUrls).toEqual(["https://saturn9.studio/"]);
    app.destroy();
  });

  it("uses the full terminal for Focus mode and exits it with Escape", async () => {
    const focusViewport = { width: 101, height: 8 };
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: "F2" }, focusViewport);
    await app.whenIdle();
    const focus = app.frame(focusViewport.width, focusViewport.height);

    expect(focus.rows).toHaveLength(focusViewport.height);
    expect(focus.rows.every(
      (row) => row.cells.length === focusViewport.width,
    )).toBe(true);
    expect(frameText(app, focusViewport)).not.toContain(
      "File  Edit  View  Insert  Format  Help",
    );
    expect(frameText(app, focusViewport)).not.toContain("F2 Focus");
    expect(focus.rows[0]?.cells[0]?.style.role).toBe("flowEditorBackground");
    expect(focus.rows.at(-1)?.cells[0]?.style.role).toBe(
      "flowEditorBackground",
    );
    expect(focus.rows.flatMap((row) => row.cells).some(
      (cell) =>
        cell.style.role === "flowEditorMargin" ||
        cell.style.role === "flowScrollbarTrack" ||
        cell.style.role === "flowScrollbarThumb",
    )).toBe(false);
    expect(focus.cursor.row).toBe(1);
    expect(focus.cursor.column).toBe(10);

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: 1,
      column: 12,
    }, focusViewport);
    expect(app.frame(focusViewport.width, focusViewport.height).cursor.column)
      .toBe(12);

    app.handleInput({ kind: "key", key: "F10" }, focusViewport);
    expect(frameText(app, focusViewport)).not.toContain("Settings...");

    app.handleInput({ kind: "key", key: "Escape" }, focusViewport);
    await app.whenIdle();

    expect(app.activeMode).toBe("edit");
    expect(frameText(app, focusViewport)).toContain(
      "File  Edit  View  Insert  Format  Help",
    );
    expect(frameText(app, focusViewport)).toContain("F3 Edit");
    app.destroy();
  });

  it("preserves editor content outside the open menu box", async () => {
    const files = new MemoryFileService({
      "/draft.md": "x".repeat(77),
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );
    const before = app.frame(viewport.width, viewport.height);
    expect(before.rows[2]?.cells[60]?.text).toBe("x");

    app.handleInput({ kind: "key", key: "F10" }, viewport);
    const menu = app.frame(viewport.width, viewport.height);

    const itemRow = menu.rows[2]!;
    expect(itemRow.cells[60]?.text).toBe("x");
    expect(itemRow.cells[60]?.style.role).not.toBe("flowMenuDropdown");
    expect(itemRow.cells[1]?.style.role).toBe("flowMenuDropdown");
    expect(itemRow.cells[2]?.style.role).toBe("flowMenuSelected");
    const rightBorder = itemRow.cells.findLastIndex(
      (cell) => cell.text === "│",
    );
    expect(itemRow.cells[rightBorder]?.style.role).toBe("flowMenuDropdown");
    app.destroy();
  });

  it("centers an 82-column padded editor and reserves a scrollbar gutter", async () => {
    const wideViewport = { width: 101, height: 8 };
    const files = new MemoryFileService({ "/draft.md": "x" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    const frame = app.frame(wideViewport.width, wideViewport.height);
    const topPadding = frame.rows[1]!;
    const editorFrameRow = frame.rows[2]!;
    const editorRow = editorFrameRow.cells.map((cell) => cell.text).join("");
    expect(editorRow.indexOf("x")).toBe(10);
    expect(editorRow).toHaveLength(101);
    expect(topPadding.cells[8]?.style.role).toBe("flowEditorMargin");
    expect(topPadding.cells[9]?.style.role).toBe("flowEditorBackground");
    expect(editorFrameRow.cells[9]?.style.role).toBe("flowEditorBackground");
    expect(editorFrameRow.cells[90]?.style.role).toBe("flowEditorBackground");
    expect(frame.rows[6]?.cells[9]?.style.role).toBe("flowEditorBackground");
    expect(frame.cursor.row).toBe(2);
    expect(frame.cursor.column).toBe(10);
    expect(editorRow.at(-1)).toBe(" ");

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: 2,
      column: 15,
    }, wideViewport);
    expect(app.frame(wideViewport.width, wideViewport.height).cursor.column)
      .toBe(11);

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: wideViewport.height - 1,
      column: 40,
    }, wideViewport);
    expect(app.frame(wideViewport.width, wideViewport.height).cursor.column)
      .toBe(11);
    app.destroy();
  });

  it("wraps editor content at 80 columns without horizontal scrolling", async () => {
    const wideViewport = { width: 101, height: 8 };
    const files = new MemoryFileService({ "/draft.md": "x".repeat(81) });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    const frame = app.frame(wideViewport.width, wideViewport.height);
    const visibleText = (row: number) => frame.rows[row]!.cells
      .map((cell) => cell.text)
      .join("")
      .trim();
    expect(visibleText(2)).toBe("x".repeat(80));
    expect(visibleText(3)).toBe("x");
    app.destroy();
  });

  it("expands inactive horizontal rules across the editor width", async () => {
    const wideViewport = { width: 101, height: 8 };
    const files = new MemoryFileService({
      "/draft.md": "plain\n\n---\n\nafter",
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    const inactiveFrame = app.frame(wideViewport.width, wideViewport.height);
    const ruleRow = inactiveFrame.rows.findIndex((row) =>
      row.cells.some((cell) => cell.style.role === "markdownSeparator")
    );
    expect(ruleRow).toBeGreaterThanOrEqual(0);
    const inactive = inactiveFrame.rows[ruleRow]!;
    const ruleCells = inactive.cells.slice(10, 90);
    expect(ruleCells.every((cell) =>
      cell.text === "─" && cell.style.role === "markdownSeparator"
    )).toBe(true);

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: ruleRow,
      column: 10,
    }, wideViewport);
    const active = app.frame(wideViewport.width, wideViewport.height).rows[ruleRow]!;
    expect(active.cells.slice(10, 90).map((cell) => cell.text).join("").trim())
      .toBe("---");
    app.destroy();
  });

  it("extends the blockquote background across the editor body", async () => {
    const wideViewport = { width: 101, height: 8 };
    const files = new MemoryFileService({
      "/draft.md": "plain\n> quote",
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    const quoteRow = app.frame(wideViewport.width, wideViewport.height).rows[3]!;
    expect(quoteRow.cells[10]?.style.role).toBe("markdownQuoteMarker");
    expect(quoteRow.cells[89]?.style.role).toBe("markdownQuote");
    expect(quoteRow.cells[90]?.style.role).toBe("flowEditorBackground");
    app.destroy();
  });

  it("keeps an empty blockquote's trailing space on the quote background", async () => {
    const wideViewport = { width: 101, height: 8 };
    const files = new MemoryFileService({
      "/draft.md": "plain\n> ",
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    const quoteRow = app.frame(wideViewport.width, wideViewport.height).rows[3]!;
    expect(quoteRow.cells[10]?.style.role).toBe("markdownQuoteMarker");
    expect(quoteRow.cells[11]?.text).toBe(" ");
    expect(quoteRow.cells[11]?.style.role).toBe("markdownQuote");
    expect(quoteRow.cells[89]?.style.role).toBe("markdownQuote");
    app.destroy();
  });

  it("uses the blockquote background for inline and fenced code", async () => {
    const wideViewport = { width: 101, height: 12 };
    const files = new MemoryFileService({
      "/draft.md": [
        "plain",
        "> quote",
        "`inline`",
        "```ts",
        "const value = 1;",
        "```",
      ].join("\n"),
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    const frame = app.frame(wideViewport.width, wideViewport.height);
    const cells = frame.rows.flatMap((row) => row.cells);
    const inlineCode = cells.find((cell) =>
      cell.style.role === "markdownCode" && cell.text === "i"
    );
    const codeBlockRow = frame.rows.find((row) =>
      row.cells.some((cell) => cell.style.role?.startsWith("codeSyntax."))
    );

    expect(inlineCode).toBeDefined();
    expect(
      codeBlockRow?.cells.find((cell) =>
        cell.style.role?.startsWith("codeSyntax.")
      ),
    ).toBeDefined();
    app.destroy();
  });

  it("renders and operates the right-side vertical scrollbar", async () => {
    const smallViewport = { width: 40, height: 8 };
    const content = Array.from(
      { length: 20 },
      (_value, index) => `line ${index + 1}`,
    ).join("\n");
    const files = new MemoryFileService({ "/draft.md": content });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    const initial = app.frame(smallViewport.width, smallViewport.height);
    expect(initial.rows.slice(1, -1).some((row) =>
      row.cells.at(-1)?.text === "█"
    )).toBe(true);

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: smallViewport.height - 3,
      column: smallViewport.width - 1,
    }, smallViewport);

    const scrolled = app.frame(smallViewport.width, smallViewport.height);
    expect(scrolled.rows.map((row) =>
      row.cells.map((cell) => cell.text).join("")
    ).join("\n")).toContain("line 20");

    app.handleInput({
      kind: "mouse",
      action: "move",
      button: "left",
      row: 1,
      column: smallViewport.width - 3,
    }, smallViewport);
    app.handleInput({
      kind: "mouse",
      action: "release",
      button: "left",
      row: 1,
      column: smallViewport.width - 3,
    }, smallViewport);
    const dragged = app.frame(smallViewport.width, smallViewport.height);
    expect(dragged.rows.map((row) =>
      row.cells.map((cell) => cell.text).join("")
    ).join("\n")).toContain("line 1");
    app.destroy();
  });

  it("finds and replaces through terminal prompts", async () => {
    const files = new MemoryFileService({ "/draft.md": "one one" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: "f", ctrl: true }, viewport);
    app.handleInput({ kind: "text", text: "one" }, viewport);
    expect(frameText(app)).toContain("1 of 2");
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    expect(frameText(app)).toContain("2 of 2");
    app.handleInput({ kind: "key", key: "Escape" }, viewport);

    app.handleInput({ kind: "key", key: "h", ctrl: true }, viewport);
    app.handleInput({ kind: "text", text: "one" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "text", text: "two" }, viewport);
    app.handleInput({ kind: "key", key: "a", ctrl: true }, viewport);

    expect(app.document.content).toBe("two two");
    app.destroy();
  });

  it("inserts links and images through palette-owned prompts", async () => {
    const files = new MemoryFileService({ "/draft.md": "" });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.showPalette();
    app.handleInput({ kind: "text", text: "Link" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "text", text: "https://example.com" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    expect(app.document.content).toBe("<https://example.com>");

    app.showPalette();
    app.handleInput({ kind: "text", text: "Image" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "text", text: "image.png" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "text", text: "Cover" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    expect(app.document.content).toContain("![Cover](image.png)");
    app.destroy();
  });

  it("shows contextual link editing during vertical navigation", async () => {
    const files = new MemoryFileService({
      "/draft.md": "before\n[Saturn](https://saturn9.studio)\nafter",
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    expect(frameText(app)).toContain(
      "Link URL: https://saturn9.studio",
    );

    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    expect(frameText(app)).not.toContain("Link URL:");
    app.destroy();
  });

  it("shows contextual editing for consecutive links", async () => {
    const files = new MemoryFileService({
      "/draft.md": [
        "before",
        "[First](https://first.example)",
        "[Second](https://second.example)",
        "after",
      ].join("\n"),
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    expect(frameText(app)).toContain("Link URL: https://first.example");
    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    expect(frameText(app)).toContain("Link URL: https://second.example");
    app.destroy();
  });

  it("shows contextual image editing on right-click", async () => {
    const files = new MemoryFileService({
      "/draft.md": "before\n![Cover](missing.png)\nafter",
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );
    const frame = app.frame(viewport.width, viewport.height);
    const imageRow = frame.rows.findIndex((row) =>
      row.cells.some((cell) => cell.style.role.startsWith("markdownImage."))
    );
    const imageColumn = frame.rows[imageRow]?.cells.findIndex((cell) =>
      cell.style.role.startsWith("markdownImage.")
    ) ?? -1;
    expect(imageRow).toBeGreaterThanOrEqual(0);
    expect(imageColumn).toBeGreaterThanOrEqual(0);

    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "right",
      row: imageRow,
      column: imageColumn,
    }, viewport);

    expect(frameText(app)).toContain("Image source: missing.png");
    app.handleInput({ kind: "key", key: "ArrowDown" }, viewport);
    expect(frameText(app)).not.toContain("Image source:");
    app.destroy();
  });

  it("uses product-owned system clipboard shortcuts", async () => {
    const files = new MemoryFileService({ "/draft.md": "Copy me" });
    const platform = createTestPlatform(files, "Pasted");
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: "a", ctrl: true }, viewport);
    app.handleInput({ kind: "key", key: "c", ctrl: true }, viewport);
    await app.whenIdle();
    expect(platform.clipboardWrites).toEqual(["Copy me"]);

    await platform.clipboard.writeText("Pasted");
    app.handleInput({ kind: "key", key: "v", ctrl: true }, viewport);
    await app.whenIdle();
    expect(app.document.content).toBe("Pasted");
    app.destroy();
  });

  it("uses Command clipboard shortcuts when the terminal forwards them", async () => {
    const files = new MemoryFileService({ "/draft.md": "Copy me" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );

    app.handleInput({ kind: "key", key: "a", ctrl: true }, viewport);
    app.handleInput({ kind: "key", key: "c", meta: true }, viewport);
    await app.whenIdle();
    expect(platform.clipboardWrites).toEqual(["Copy me"]);

    await platform.clipboard.writeText("Command paste");
    app.handleInput({ kind: "key", key: "v", meta: true }, viewport);
    await app.whenIdle();
    expect(app.document.content).toBe("Command paste");
    app.destroy();
  });

  it("autosaves changed drafts and clears their recovery snapshot", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      { ...defaultFlowCliSettings, autosave: false },
    );

    app.handleInput({ kind: "text", text: "New " }, viewport);
    platform.runTimers();
    await app.whenIdle();

    expect(files.writes[0]?.content).toBe("New Draft");
    expect(platform.recoveryFor("/draft.md")).toBeNull();
    app.destroy();
  });

  it("offers to restore a crash recovery snapshot at startup", async () => {
    const files = new MemoryFileService({ "/draft.md": "Saved" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
      {
        documentPath: "/draft.md",
        content: "Recovered",
        savedAt: "2026-01-01T00:00:00.000Z",
      },
    );

    expect(frameText(app)).toContain("Unsaved recovery found");
    app.handleInput({ kind: "key", key: "r" }, viewport);
    expect(app.document.content).toBe("Recovered");
    expect(app.document.isDirty).toBe(true);
    app.destroy();
  });

  it("flushes dirty content to recovery before forced termination", async () => {
    const files = new MemoryFileService({ "/draft.md": "Saved" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );
    app.handleInput({ kind: "text", text: "Unsaved " }, viewport);

    await app.prepareForTermination();

    expect(platform.recoveryFor("/draft.md")?.content).toBe("Unsaved Saved");
    app.destroy();
  });

  it("honors persisted app-command keybindings", async () => {
    const files = new MemoryFileService({ "/draft.md": "Draft" });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      {
        ...defaultFlowCliSettings,
        keybindings: { "flow.mode.read": "Alt+R" },
      },
    );

    app.handleInput({ kind: "key", key: "r", alt: true }, viewport);

    expect(app.activeMode).toBe("read");
    app.destroy();
  });

  it("exports HTML and plain text beside the document", async () => {
    const files = new MemoryFileService({
      "/draft.md": "# Title\n\n**Body**",
    });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/draft.md"),
      platform,
      defaultFlowCliSettings,
    );

    app.showPalette();
    app.handleInput({ kind: "text", text: "Export: HTML" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    await app.whenIdle();

    expect(files.writes.at(-1)?.path).toBe("/draft.html");
    expect(files.writes.at(-1)?.content).toContain("<h1>Title</h1>");

    app.showPalette();
    app.handleInput({ kind: "text", text: "Export: Plain Text" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    await app.whenIdle();

    expect(files.writes.at(-1)).toEqual({
      path: "/draft.txt",
      content: "Title\n\nBody",
    });
    app.destroy();
  });

  it("opens, creates, and saves documents from product commands", async () => {
    const files = new MemoryFileService({
      "/first.md": "First",
      "/second.md": "Second",
    });
    const platform = createTestPlatform(files);
    const app = new FlowCliApp(
      await openDocumentSession(files, "/first.md"),
      platform,
      defaultFlowCliSettings,
    );

    app.showOpen();
    await app.whenIdle();
    const browserFrame = app.frame(viewport.width, viewport.height);
    const browserRow = browserFrame.rows.findIndex((row) => {
      const text = row.cells.map((cell) => cell.text).join("");
      return text.includes("first.md") && text.includes("second.md");
    });
    expect(browserRow).toBeGreaterThanOrEqual(0);
    const secondColumn = browserFrame.rows[browserRow]?.cells
      .map((cell) => cell.text).join("").indexOf("second.md") ?? -1;
    expect(secondColumn).toBeGreaterThanOrEqual(0);
    app.handleInput({
      kind: "mouse",
      action: "press",
      button: "left",
      row: browserRow,
      column: secondColumn,
    }, viewport);
    await app.whenIdle();
    expect(app.document.path).toBe("/second.md");
    expect(app.document.content).toBe("Second");

    app.handleInput({ kind: "text", text: "Changed " }, viewport);
    app.showSaveAs();
    for (let index = 0; index < "/second.md".length; index += 1) {
      app.handleInput({ kind: "key", key: "Backspace" }, viewport);
    }
    app.handleInput({ kind: "text", text: "third.md" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    await app.whenIdle();
    expect(app.document.path).toBe("/third.md");
    expect(files.writes.at(-1)?.path).toBe("/third.md");

    await app.newDocument();
    expect(app.document.isTemporary).toBe(true);
    expect(app.document.content).toBe("");
    app.destroy();
  });

  it("browses folders and filters Open results to Markdown files", async () => {
    const files = new MemoryFileService({
      "/writing/current.md": "Current",
      "/writing/draft.md": "Draft",
      "/writing/notes.txt": "Hidden",
      "/writing/archive/older.md": "Older",
      "/writing/archive/data.json": "{}",
      "/writing/.private/secret.md": "Secret",
    });
    const app = new FlowCliApp(
      await openDocumentSession(files, "/writing/current.md"),
      createTestPlatform(files),
      defaultFlowCliSettings,
    );

    app.showOpen();
    await app.whenIdle();

    expect(frameText(app)).toContain("/writing");
    expect(frameText(app)).toContain("▸ ..");
    expect(frameText(app)).toContain("archive/");
    expect(frameText(app)).toContain("current.md");
    expect(frameText(app)).toContain("draft.md");
    expect(frameText(app)).not.toContain("notes.txt");
    expect(frameText(app)).not.toContain(".private");

    app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    await app.whenIdle();
    expect(frameText(app)).toContain("/writing/archive");
    expect(frameText(app)).toContain("older.md");
    expect(frameText(app)).not.toContain("data.json");

    app.handleInput({ kind: "key", key: "Backspace" }, viewport);
    await app.whenIdle();
    expect(frameText(app)).toContain("/writing");

    app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    await app.whenIdle();
    app.handleInput({ kind: "key", key: "ArrowRight" }, viewport);
    app.handleInput({ kind: "key", key: "Enter" }, viewport);
    await app.whenIdle();
    expect(app.document.path).toBe("/writing/archive/older.md");
    app.destroy();
  });
});

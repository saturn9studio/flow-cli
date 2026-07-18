import { describe, expect, it, vi } from "vitest";
import {
  boot,
  CommandRegistry,
  flowCommandNames,
  type Command,
} from "../../src/markdown/index.js";

const select = (
  flowEditor: ReturnType<typeof boot>,
  anchor: { paragraph: number; offset: number },
  head = anchor,
): void => {
  flowEditor.editor.dispatch(
    flowEditor.editor.createTransaction().setSelection({ anchor, head }).build(),
  );
};

describe("Flow CLI commands", () => {
  it("reports command state and notifies registry listeners", () => {
    const registry = new CommandRegistry();
    const listener = vi.fn();
    registry.onUpdate(listener);
    const flowEditor = boot({ content: "word", commandRegistry: registry });

    expect(registry.getCommandData(flowCommandNames.undo)?.enabled).toBe(false);
    select(flowEditor, { paragraph: 0, offset: 0 }, { paragraph: 0, offset: 4 });
    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("**word**");
    expect(registry.getCommandData(flowCommandNames.undo)?.enabled).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it.each([
    [flowCommandNames.bold, "**word**"],
    [flowCommandNames.italic, "*word*"],
    [flowCommandNames.underline, "~word~"],
    [flowCommandNames.strikethrough, "~~word~~"],
    [flowCommandNames.code, "`word`"],
    [flowCommandNames.math, "$word$"],
    [flowCommandNames.highlight, "==word=="],
  ])("formats the word at a collapsed caret with %s", (command, expected) => {
    const flowEditor = boot({ content: "word" });
    select(flowEditor, { paragraph: 0, offset: 2 });

    expect(flowEditor.executeCommand(command)).toBe(true);
    expect(flowEditor.getContent()).toBe(expected);
    expect(flowEditor.editor.snapshot().selection.head.offset).toBe(
      2 + (expected.length - 4) / 2,
    );
  });

  it("inserts empty markers on whitespace and in an empty paragraph", () => {
    const flowEditor = boot({ content: "word next" });
    select(flowEditor, { paragraph: 0, offset: 4 });

    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("word**** next");
    expect(flowEditor.editor.snapshot().selection.head.offset).toBe(6);

    flowEditor.setContent("");
    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("****");
    expect(flowEditor.editor.snapshot().selection.head.offset).toBe(2);
  });

  it("formats a word at its final boundary and toggles existing formatting", () => {
    const flowEditor = boot({ content: "word" });
    select(flowEditor, { paragraph: 0, offset: 4 });

    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("**word**");
    expect(flowEditor.editor.snapshot().selection.head.offset).toBe(6);

    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("word");
    expect(flowEditor.editor.snapshot().selection.head.offset).toBe(4);
  });

  it.each([
    ["**word**", flowCommandNames.italic, "***word***"],
    ["~~word~~", flowCommandNames.underline, "~~~word~~~"],
  ])("combines overlapping markers in %s", (content, command, combined) => {
    const flowEditor = boot({ content });
    select(flowEditor, { paragraph: 0, offset: 4 });

    expect(flowEditor.executeCommand(command)).toBe(true);
    expect(flowEditor.getContent()).toBe(combined);
    expect(flowEditor.executeCommand(command)).toBe(true);
    expect(flowEditor.getContent()).toBe(content);
  });

  it("formats each selected paragraph with independent markers", () => {
    const flowEditor = boot({ content: "Paragraph one\nParagraph two" });
    select(
      flowEditor,
      { paragraph: 0, offset: 10 },
      { paragraph: 1, offset: 4 },
    );

    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe(
      "Paragraph **one**\n**Para**graph two",
    );
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 12 },
      head: { paragraph: 1, offset: 6 },
    });
  });

  it.each([
    [flowCommandNames.bold, "**"],
    [flowCommandNames.italic, "*"],
    [flowCommandNames.underline, "~"],
    [flowCommandNames.strikethrough, "~~"],
    [flowCommandNames.code, "`"],
    [flowCommandNames.math, "$"],
    [flowCommandNames.highlight, "=="],
  ])("toggles %s across paragraphs", (command, marker) => {
    const flowEditor = boot({ content: "one\ntwo" });
    select(flowEditor, { paragraph: 0, offset: 0 }, { paragraph: 1, offset: 3 });

    expect(flowEditor.executeCommand(command)).toBe(true);
    expect(flowEditor.getContent()).toBe(
      `${marker}one${marker}\n${marker}two${marker}`,
    );
    expect(flowEditor.executeCommand(command)).toBe(true);
    expect(flowEditor.getContent()).toBe("one\ntwo");
  });

  it("toggles formatting off for selected content inside its markers", () => {
    const registry = new CommandRegistry();
    const flowEditor = boot({ content: "**bold**", commandRegistry: registry });
    select(flowEditor, { paragraph: 0, offset: 2 }, { paragraph: 0, offset: 6 });

    expect(registry.getCommandData(flowCommandNames.bold)?.active).toBe(true);
    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("bold");
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 4 },
    });
  });

  it("toggles an enclosing formatted phrase off from a collapsed caret", () => {
    const registry = new CommandRegistry();
    const flowEditor = boot({
      content: "**bold phrase**",
      commandRegistry: registry,
    });
    select(flowEditor, { paragraph: 0, offset: 4 });

    expect(registry.getCommandData(flowCommandNames.bold)?.active).toBe(true);
    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("bold phrase");
    expect(flowEditor.editor.snapshot().selection.head.offset).toBe(2);
  });

  it("uses the caret rather than adjacent formatting for collapsed state", () => {
    const registry = new CommandRegistry();
    const flowEditor = boot({
      content: "**bold**next",
      commandRegistry: registry,
    });
    select(flowEditor, { paragraph: 0, offset: 10 });

    expect(registry.getCommandData(flowCommandNames.bold)?.active).toBe(false);
    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("**boldnext**");
  });

  it("merges mixed existing formatting within each selected paragraph", () => {
    const flowEditor = boot({
      content: [
        "This is **multiple**",
        "**paragraph** text **with selection**",
        "**spanning multiple paragraphs** too",
      ].join("\n"),
    });
    select(
      flowEditor,
      { paragraph: 0, offset: 8 },
      { paragraph: 2, offset: 32 },
    );

    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe([
      "This is **multiple**",
      "**paragraph text with selection**",
      "**spanning multiple paragraphs** too",
    ].join("\n"));
  });

  it("toggles formatting off across fully covered paragraphs", () => {
    const flowEditor = boot({ content: "**one**\n**two**" });
    select(flowEditor, { paragraph: 0, offset: 2 }, { paragraph: 1, offset: 5 });

    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("one\ntwo");
  });

  it("excludes a paragraph when the selection ends at its start", () => {
    const flowEditor = boot({ content: "one\ntwo" });
    select(flowEditor, { paragraph: 0, offset: 0 }, { paragraph: 1, offset: 0 });

    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(flowEditor.getContent()).toBe("**one**\ntwo");
  });

  it("preserves backward selections while formatting paragraphs", () => {
    const flowEditor = boot({ content: "one\ntwo" });
    select(flowEditor, { paragraph: 1, offset: 3 }, { paragraph: 0, offset: 0 });

    expect(flowEditor.executeCommand(flowCommandNames.italic)).toBe(true);
    expect(flowEditor.getContent()).toBe("*one*\n*two*");
    expect(flowEditor.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 1, offset: 4 },
      head: { paragraph: 0, offset: 1 },
    });
  });

  it("recognizes alternate markers and skips fenced code paragraphs", () => {
    const alternate = boot({ content: "__bold__" });
    select(
      alternate,
      { paragraph: 0, offset: 2 },
      { paragraph: 0, offset: 6 },
    );
    expect(alternate.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(alternate.getContent()).toBe("bold");

    const fenced = boot({ content: "```\ncode\n```\ntext" });
    select(fenced, { paragraph: 0, offset: 0 }, { paragraph: 3, offset: 4 });
    expect(fenced.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(fenced.getContent()).toBe("```\ncode\n```\n**text**");

    const inlineCode = boot({ content: "```word```" });
    select(inlineCode, { paragraph: 0, offset: 3 }, { paragraph: 0, offset: 7 });
    expect(inlineCode.executeCommand(flowCommandNames.code)).toBe(true);
    expect(inlineCode.getContent()).toBe("word");

    const inlineMath = boot({ content: "$word$" });
    select(inlineMath, { paragraph: 0, offset: 1 }, { paragraph: 0, offset: 5 });
    expect(inlineMath.executeCommand(flowCommandNames.math)).toBe(true);
    expect(inlineMath.getContent()).toBe("word");
  });

  it("transforms all selected paragraphs and preserves history", () => {
    const flowEditor = boot({ content: "one\ntwo" });
    select(flowEditor, { paragraph: 0, offset: 0 }, { paragraph: 1, offset: 3 });
    expect(flowEditor.executeCommand(flowCommandNames.bulletList)).toBe(true);
    expect(flowEditor.getContent()).toBe("- one\n- two");
    expect(flowEditor.executeCommand(flowCommandNames.bulletList)).toBe(true);
    expect(flowEditor.getContent()).toBe("one\ntwo");
    expect(flowEditor.executeCommand(flowCommandNames.undo)).toBe(true);
    expect(flowEditor.getContent()).toBe("- one\n- two");
    expect(flowEditor.executeCommand(flowCommandNames.redo)).toBe(true);
    expect(flowEditor.getContent()).toBe("one\ntwo");
  });

  it("supports headings, code blocks, separators, and tables", () => {
    const flowEditor = boot({ content: "title" });
    select(flowEditor, { paragraph: 0, offset: 0 }, { paragraph: 0, offset: 5 });
    expect(flowEditor.executeCommand(flowCommandNames.heading2)).toBe(true);
    expect(flowEditor.getContent()).toBe("## title");

    select(flowEditor, { paragraph: 0, offset: 8 });
    expect(flowEditor.executeCommand(flowCommandNames.codeBlock)).toBe(true);
    expect(flowEditor.getContent()).toContain("```\n\n```");
    expect(flowEditor.executeCommand(flowCommandNames.horizontalRule)).toBe(true);
    expect(flowEditor.getContent()).toContain("---");
    expect(flowEditor.insertTable({ rows: 1, columns: 1 })).toBe(true);
    expect(flowEditor.getContent()).toContain("| Header 1 |");
  });

  it("supports math blocks", () => {
    const flowEditor = boot({ content: "E = mc^2" });
    select(flowEditor, { paragraph: 0, offset: 0 }, { paragraph: 0, offset: 8 });

    expect(flowEditor.executeCommand(flowCommandNames.mathBlock)).toBe(true);
    expect(flowEditor.getContent()).toBe("$$\nE = mc^2\n$$");

    select(flowEditor, { paragraph: 0, offset: 0 }, { paragraph: 2, offset: 2 });
    expect(flowEditor.executeCommand(flowCommandNames.mathBlock)).toBe(true);
    expect(flowEditor.getContent()).toBe("E = mc^2");

    flowEditor.setContent("");
    select(flowEditor, { paragraph: 0, offset: 0 });
    expect(flowEditor.executeCommand(flowCommandNames.mathBlock)).toBe(true);
    expect(flowEditor.getContent()).toBe("$$\n\n$$");
    expect(flowEditor.editor.snapshot().selection.head).toEqual({
      paragraph: 1,
      offset: 0,
    });
  });

  it("inserts a three-column table with one body row by default", () => {
    const flowEditor = boot({ content: "" });

    expect(flowEditor.executeCommand(flowCommandNames.table)).toBe(true);
    expect(flowEditor.getContent()).toBe([
      "| Header 1 | Header 2 | Header 3 |",
      "| --- | --- | --- |",
      "|  |  |  |",
    ].join("\n"));
  });

  it("allows custom commands to replace defaults and blocks mutations read-only", () => {
    const run = vi.fn(() => true);
    const command: Command = {
      id: flowCommandNames.bold,
      label: "Custom Bold",
      run,
    };
    const flowEditor = boot({ content: "text", commands: [command] });
    expect(flowEditor.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(run).toHaveBeenCalledOnce();

    const readOnly = boot({ content: "text", readOnly: true });
    expect(readOnly.executeCommand(flowCommandNames.bold)).toBe(false);
    expect(readOnly.getContent()).toBe("text");
  });

  it("executes commands registered after boot", () => {
    const flowEditor = boot();
    const run = vi.fn(() => true);
    flowEditor.commandRegistry.register({
      id: "custom.runtime",
      label: "Runtime command",
      run,
    });
    expect(flowEditor.executeCommand("custom.runtime")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});

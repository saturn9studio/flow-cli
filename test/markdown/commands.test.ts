import { describe, expect, it, vi } from "vitest";
import {
  boot,
  CommandRegistry,
  flowCommandNames,
  type Command,
} from "../../src/markdown/index.js";

const select = (
  scribe: ReturnType<typeof boot>,
  anchor: { paragraph: number; offset: number },
  head = anchor,
): void => {
  scribe.editor.dispatch(
    scribe.editor.createTransaction().setSelection({ anchor, head }).build(),
  );
};

describe("Flow CLI commands", () => {
  it("reports command state and notifies registry listeners", () => {
    const registry = new CommandRegistry();
    const listener = vi.fn();
    registry.onUpdate(listener);
    const scribe = boot({ content: "word", commandRegistry: registry });

    expect(registry.getCommandData(flowCommandNames.undo)?.enabled).toBe(false);
    select(scribe, { paragraph: 0, offset: 0 }, { paragraph: 0, offset: 4 });
    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("**word**");
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
    const scribe = boot({ content: "word" });
    select(scribe, { paragraph: 0, offset: 2 });

    expect(scribe.executeCommand(command)).toBe(true);
    expect(scribe.getContent()).toBe(expected);
    expect(scribe.editor.snapshot().selection.head.offset).toBe(
      2 + (expected.length - 4) / 2,
    );
  });

  it("inserts empty markers on whitespace and in an empty paragraph", () => {
    const scribe = boot({ content: "word next" });
    select(scribe, { paragraph: 0, offset: 4 });

    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("word**** next");
    expect(scribe.editor.snapshot().selection.head.offset).toBe(6);

    scribe.setContent("");
    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("****");
    expect(scribe.editor.snapshot().selection.head.offset).toBe(2);
  });

  it("formats a word at its final boundary and toggles existing formatting", () => {
    const scribe = boot({ content: "word" });
    select(scribe, { paragraph: 0, offset: 4 });

    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("**word**");
    expect(scribe.editor.snapshot().selection.head.offset).toBe(6);

    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("word");
    expect(scribe.editor.snapshot().selection.head.offset).toBe(4);
  });

  it.each([
    ["**word**", flowCommandNames.italic, "***word***"],
    ["~~word~~", flowCommandNames.underline, "~~~word~~~"],
  ])("combines overlapping markers in %s", (content, command, combined) => {
    const scribe = boot({ content });
    select(scribe, { paragraph: 0, offset: 4 });

    expect(scribe.executeCommand(command)).toBe(true);
    expect(scribe.getContent()).toBe(combined);
    expect(scribe.executeCommand(command)).toBe(true);
    expect(scribe.getContent()).toBe(content);
  });

  it("formats each selected paragraph with independent markers", () => {
    const scribe = boot({ content: "Paragraph one\nParagraph two" });
    select(
      scribe,
      { paragraph: 0, offset: 10 },
      { paragraph: 1, offset: 4 },
    );

    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe(
      "Paragraph **one**\n**Para**graph two",
    );
    expect(scribe.editor.snapshot().selection).toEqual({
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
    const scribe = boot({ content: "one\ntwo" });
    select(scribe, { paragraph: 0, offset: 0 }, { paragraph: 1, offset: 3 });

    expect(scribe.executeCommand(command)).toBe(true);
    expect(scribe.getContent()).toBe(
      `${marker}one${marker}\n${marker}two${marker}`,
    );
    expect(scribe.executeCommand(command)).toBe(true);
    expect(scribe.getContent()).toBe("one\ntwo");
  });

  it("toggles formatting off for selected content inside its markers", () => {
    const registry = new CommandRegistry();
    const scribe = boot({ content: "**bold**", commandRegistry: registry });
    select(scribe, { paragraph: 0, offset: 2 }, { paragraph: 0, offset: 6 });

    expect(registry.getCommandData(flowCommandNames.bold)?.active).toBe(true);
    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("bold");
    expect(scribe.editor.snapshot().selection).toEqual({
      anchor: { paragraph: 0, offset: 0 },
      head: { paragraph: 0, offset: 4 },
    });
  });

  it("toggles an enclosing formatted phrase off from a collapsed caret", () => {
    const registry = new CommandRegistry();
    const scribe = boot({
      content: "**bold phrase**",
      commandRegistry: registry,
    });
    select(scribe, { paragraph: 0, offset: 4 });

    expect(registry.getCommandData(flowCommandNames.bold)?.active).toBe(true);
    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("bold phrase");
    expect(scribe.editor.snapshot().selection.head.offset).toBe(2);
  });

  it("uses the caret rather than adjacent formatting for collapsed state", () => {
    const registry = new CommandRegistry();
    const scribe = boot({
      content: "**bold**next",
      commandRegistry: registry,
    });
    select(scribe, { paragraph: 0, offset: 10 });

    expect(registry.getCommandData(flowCommandNames.bold)?.active).toBe(false);
    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("**boldnext**");
  });

  it("merges mixed existing formatting within each selected paragraph", () => {
    const scribe = boot({
      content: [
        "This is **multiple**",
        "**paragraph** text **with selection**",
        "**spanning multiple paragraphs** too",
      ].join("\n"),
    });
    select(
      scribe,
      { paragraph: 0, offset: 8 },
      { paragraph: 2, offset: 32 },
    );

    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe([
      "This is **multiple**",
      "**paragraph text with selection**",
      "**spanning multiple paragraphs** too",
    ].join("\n"));
  });

  it("toggles formatting off across fully covered paragraphs", () => {
    const scribe = boot({ content: "**one**\n**two**" });
    select(scribe, { paragraph: 0, offset: 2 }, { paragraph: 1, offset: 5 });

    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("one\ntwo");
  });

  it("excludes a paragraph when the selection ends at its start", () => {
    const scribe = boot({ content: "one\ntwo" });
    select(scribe, { paragraph: 0, offset: 0 }, { paragraph: 1, offset: 0 });

    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(scribe.getContent()).toBe("**one**\ntwo");
  });

  it("preserves backward selections while formatting paragraphs", () => {
    const scribe = boot({ content: "one\ntwo" });
    select(scribe, { paragraph: 1, offset: 3 }, { paragraph: 0, offset: 0 });

    expect(scribe.executeCommand(flowCommandNames.italic)).toBe(true);
    expect(scribe.getContent()).toBe("*one*\n*two*");
    expect(scribe.editor.snapshot().selection).toEqual({
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
    const scribe = boot({ content: "one\ntwo" });
    select(scribe, { paragraph: 0, offset: 0 }, { paragraph: 1, offset: 3 });
    expect(scribe.executeCommand(flowCommandNames.bulletList)).toBe(true);
    expect(scribe.getContent()).toBe("- one\n- two");
    expect(scribe.executeCommand(flowCommandNames.bulletList)).toBe(true);
    expect(scribe.getContent()).toBe("one\ntwo");
    expect(scribe.executeCommand(flowCommandNames.undo)).toBe(true);
    expect(scribe.getContent()).toBe("- one\n- two");
    expect(scribe.executeCommand(flowCommandNames.redo)).toBe(true);
    expect(scribe.getContent()).toBe("one\ntwo");
  });

  it("supports headings, code blocks, separators, and tables", () => {
    const scribe = boot({ content: "title" });
    select(scribe, { paragraph: 0, offset: 0 }, { paragraph: 0, offset: 5 });
    expect(scribe.executeCommand(flowCommandNames.heading2)).toBe(true);
    expect(scribe.getContent()).toBe("## title");

    select(scribe, { paragraph: 0, offset: 8 });
    expect(scribe.executeCommand(flowCommandNames.codeBlock)).toBe(true);
    expect(scribe.getContent()).toContain("```\n\n```");
    expect(scribe.executeCommand(flowCommandNames.horizontalRule)).toBe(true);
    expect(scribe.getContent()).toContain("---");
    expect(scribe.insertTable({ rows: 1, columns: 1 })).toBe(true);
    expect(scribe.getContent()).toContain("| Header 1 |");
  });

  it("supports math blocks", () => {
    const scribe = boot({ content: "E = mc^2" });
    select(scribe, { paragraph: 0, offset: 0 }, { paragraph: 0, offset: 8 });

    expect(scribe.executeCommand(flowCommandNames.mathBlock)).toBe(true);
    expect(scribe.getContent()).toBe("$$\nE = mc^2\n$$");

    select(scribe, { paragraph: 0, offset: 0 }, { paragraph: 2, offset: 2 });
    expect(scribe.executeCommand(flowCommandNames.mathBlock)).toBe(true);
    expect(scribe.getContent()).toBe("E = mc^2");

    scribe.setContent("");
    select(scribe, { paragraph: 0, offset: 0 });
    expect(scribe.executeCommand(flowCommandNames.mathBlock)).toBe(true);
    expect(scribe.getContent()).toBe("$$\n\n$$");
    expect(scribe.editor.snapshot().selection.head).toEqual({
      paragraph: 1,
      offset: 0,
    });
  });

  it("inserts a three-column table with one body row by default", () => {
    const scribe = boot({ content: "" });

    expect(scribe.executeCommand(flowCommandNames.table)).toBe(true);
    expect(scribe.getContent()).toBe([
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
    const scribe = boot({ content: "text", commands: [command] });
    expect(scribe.executeCommand(flowCommandNames.bold)).toBe(true);
    expect(run).toHaveBeenCalledOnce();

    const readOnly = boot({ content: "text", readOnly: true });
    expect(readOnly.executeCommand(flowCommandNames.bold)).toBe(false);
    expect(readOnly.getContent()).toBe("text");
  });

  it("executes commands registered after boot", () => {
    const scribe = boot();
    const run = vi.fn(() => true);
    scribe.commandRegistry.register({
      id: "custom.runtime",
      label: "Runtime command",
      run,
    });
    expect(scribe.executeCommand("custom.runtime")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});

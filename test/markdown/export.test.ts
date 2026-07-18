import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  boot,
  exportToHtmlString,
  exportToMarkdownString,
  markdownToPlainText,
  renderMarkdownToHtml,
} from "../../src/markdown/index.js";

describe("Flow CLI string exports", () => {
  it("exports canonical Markdown without transformation", () => {
    const markdown = "# Title\n\nText";
    expect(exportToMarkdownString(markdown)).toBe(markdown);
  });

  it("renders supported authoring syntax to an HTML fragment", () => {
    const html = renderMarkdownToHtml([
      "# Title",
      "",
      "**bold** *italic* ~under~ ~~gone~~ ==🟦marked==",
      "Inline math $E = mc^2$",
      "",
      "[site](https://example.com) ![Alt](image.png \"Title\")",
      "",
      "- one",
      "- two",
      "",
      "$$",
      "\\frac{a}{b} = c",
      "$$",
      "",
      "```ts",
      "const value = 1;",
      "```",
      "",
      "| A | B |",
      "| --- | :---: |",
      "| 1 | 2 |",
    ].join("\n"), { fragment: true });

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<u>under</u>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain('<mark data-highlight="🟦">marked</mark>');
    expect(html).toContain('<span class="math math-inline"><span class="katex">');
    expect(html).toContain('<div class="math math-block"><span class="katex">');
    expect(html).toContain('<annotation encoding="application/x-tex">E = mc^2</annotation>');
    expect(html).toContain('display="block"');
    expect(html).toContain("<mfrac>");
    expect(html).toContain('<a href="https://example.com">site</a>');
    expect(html).toContain('<img src="image.png" alt="Alt" title="Title" />');
    expect(html).toContain("<ul>");
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain("<table>");
    expect(html).toContain('<th style="text-align:center">B</th>');
  });

  it("produces a self-contained HTML document", () => {
    const html = exportToHtmlString("Text", { title: "Draft" });
    expect(html).toMatch(/^<!DOCTYPE html>/u);
    expect(html).toContain("<title>Draft</title>");
    expect(html).toContain("<p>Text</p>");
  });

  it("creates readable plain text from structured Markdown", () => {
    expect(markdownToPlainText([
      "# Draft",
      "",
      "A **bold** ==marked== paragraph with $E = mc^2$.",
      "",
      "$$",
      "\\frac{a}{b} = c",
      "$$",
      "",
      "- one",
      "- two",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n"))).toBe([
      "Draft",
      "",
      "A bold marked paragraph with E = mc^2.",
      "",
      "\\frac{a}{b} = c",
      "",
      "- one",
      "- two",
      "",
      "A\tB",
      "1\t2",
    ].join("\n"));
  });

  it("escapes source text and document metadata", () => {
    const html = exportToHtmlString("<script>alert(1)</script>", {
      title: "<Draft>",
    });

    expect(html).toContain("<title>&lt;Draft&gt;</title>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders invalid math as escaped KaTeX errors", () => {
    const html = renderMarkdownToHtml(
      "Inline $\\notacommand{<script>$",
      { fragment: true },
    );

    expect(html).toContain('class="katex-error"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("removes active-content URL schemes from exported HTML", () => {
    const html = renderMarkdownToHtml([
      "[unsafe](javascript:alert(1))",
      "![unsafe](data:text/html;base64,PHNjcmlwdD4=)",
      "[safe](https://example.com)",
      "[relative](./draft.md)",
    ].join("\n\n"), { fragment: true });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).toContain('<a href="https://example.com">safe</a>');
    expect(html).toContain('<a href="./draft.md">relative</a>');
  });

  it("keeps the compatibility fixture canonical across editor and exports", () => {
    const markdown = readFileSync(
      new URL("./fixtures/compatibility.md", import.meta.url),
      "utf8",
    );
    const scribe = boot({ content: markdown });
    expect(scribe.getContent()).toBe(markdown);
    const html = renderMarkdownToHtml(markdown, { fragment: true });
    expect(html).toContain("<table>");
    expect(html).toContain('<code class="language-ts">');
    expect(markdownToPlainText(markdown)).toContain("Compatibility");
  });
});

import { describe, expect, it } from "vitest";
import {
  applyTransfer,
  boot,
  createReadTransferEffect,
  createTransferPayload,
  createWriteTransferEffect,
  htmlToMarkdown,
  markdownFromTransfer,
  selectionTransferPayload,
} from "../../src/markdown/index.js";

describe("Flow CLI transfer helpers", () => {
  it("converts supported HTML to canonical Markdown without browser APIs", () => {
    const markdown = htmlToMarkdown([
      "<h2>Heading</h2>",
      "<p><strong>Bold</strong> <em>italic</em> <mark>marked</mark></p>",
      '<p><a href="https://example.com" title="Site">Link</a> ',
      '<img src="image.png" alt="Alt"></p>',
      "<ul><li>One</li><li><input type=\"checkbox\" checked>Done</li></ul>",
      '<pre><code class="language-ts">const x = 1;</code></pre>',
      "<table><thead><tr><th>A</th><th>B</th></tr></thead>",
      "<tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
    ].join(""));
    expect(markdown).toContain("## Heading");
    expect(markdown).toContain("**Bold** *italic* ==marked==");
    expect(markdown).toContain('[Link](https://example.com "Site")');
    expect(markdown).toContain("![Alt](image.png)");
    expect(markdown).toContain("- One\n- [x] Done");
    expect(markdown).toContain("```ts\nconst x = 1;\n```");
    expect(markdown).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("uses Markdown, HTML, then plain text transfer precedence", () => {
    expect(markdownFromTransfer({
      markdown: "**markdown**",
      html: "<b>html</b>",
      plainText: "plain",
    })).toBe("**markdown**");
    expect(markdownFromTransfer({
      html: "<b>html</b>",
      plainText: "plain",
    })).toBe("**html**");
    expect(markdownFromTransfer({ plainText: "plain" })).toBe("plain");
  });

  it("replaces invalid numeric HTML entities without throwing", () => {
    expect(htmlToMarkdown("<p>&#1114112; &#xFFFFFFFF; &#xD800;</p>"))
      .toBe("\ufffd \ufffd \ufffd");
  });

  it("creates a typed payload for the selected canonical source", () => {
    const scribe = boot({ content: "before **bold** after" });
    scribe.editor.dispatch(
      scribe.editor
        .createTransaction()
        .setSelection({
          anchor: { paragraph: 0, offset: 7 },
          head: { paragraph: 0, offset: 15 },
        })
        .build(),
    );
    expect(selectionTransferPayload(scribe.editor)).toEqual({
      plainText: "bold",
      markdown: "**bold**",
      html: "<p><strong>bold</strong></p>\n",
    });
  });

  it("applies transferred source transactionally and honors read-only", () => {
    const scribe = boot({ content: "Text" });
    expect(applyTransfer(scribe.editor, { html: "<strong>Bold</strong>" }))
      .toBe(true);
    expect(scribe.getContent()).toBe("**Bold**Text");
    expect(scribe.editor.execute("editor.undo")).toBe(true);
    expect(scribe.getContent()).toBe("Text");

    scribe.setReadOnly(true);
    expect(applyTransfer(scribe.editor, { plainText: "No" })).toBe(false);
    expect(scribe.getContent()).toBe("Text");
  });

  it("describes clipboard boundaries as host effects", () => {
    const payload = createTransferPayload("# Draft");
    expect(createWriteTransferEffect("# Draft")).toEqual({
      type: "writeTransfer",
      payload,
    });
    expect(createReadTransferEffect()).toEqual({
      type: "readTransfer",
      accepted: ["text/markdown", "text/html", "text/plain"],
    });
  });
});

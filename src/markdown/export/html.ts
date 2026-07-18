import { parseDocument, type Token } from "@saturn9/markoffset";
import katex from "katex";
import { flowCliMarkdownParser } from "../presentation/parser.js";

export interface HtmlExportOptions {
  readonly title?: string;
  readonly fragment?: boolean;
}

const stylesheet = `body{max-width:42em;margin:2em auto;padding:0 1em;color:#222;font-family:serif;line-height:1.6}code{background:#f4f4f4;border-radius:3px;font-family:monospace;padding:.15em .3em}pre code{display:block;overflow-x:auto;padding:1em}blockquote{border-left:3px solid #ccc;color:#555;margin-left:0;padding-left:1em}mark{background:#fff3b0}.math{font-family:serif}.math-block{display:block;margin:1em 0;text-align:center}.katex-error{color:#c00}img{max-width:100%}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.3em .6em}`;

interface HtmlRenderContext {
  readonly macros: Record<string, string>;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");

const safeUrl = (url: string): string | null => {
  const trimmed = url.trim();
  const scheme = trimmed
    .replace(/[\u0000-\u0020\u007f]+/gu, "")
    .match(/^([A-Za-z][A-Za-z0-9+.-]*):/u)?.[1]
    ?.toLowerCase();
  return scheme && !["http", "https", "mailto", "tel"].includes(scheme)
    ? null
    : trimmed;
};

const encodeUrl = (url: string): string => {
  try {
    return encodeURI(url)
      .replace(/%25([0-9A-Fa-f]{2})/gu, "%$1")
      .replace(/[&<>"]/gu, escapeHtml);
  } catch {
    return escapeHtml(url);
  }
};

const plainTokenText = (tokens: readonly Token[]): string =>
  tokens.map((token) => {
    if (token.kind === "softbreak" || token.kind === "hardbreak") return "\n";
    return token.children
      ? plainTokenText(token.children)
      : token.content ?? "";
  }).join("");

const renderMarkdownText = (text: string): string =>
  escapeHtml(text).replace(
    /==(?:(🟩|🟥|🟦|🟧|🟪))?([^=]+?)==/gu,
    (_match, emoji: string | undefined, content: string) =>
      `<mark${emoji ? ` data-highlight="${escapeHtml(emoji)}"` : ""}>${content}</mark>`,
  );

const renderMath = (
  source: string,
  displayMode: boolean,
  context: HtmlRenderContext,
): string =>
  katex.renderToString(displayMode ? source.trim() : source, {
    displayMode,
    output: "mathml",
    throwOnError: false,
    macros: context.macros,
  });

const renderTokens = (
  tokens: readonly Token[],
  tight = false,
  context: HtmlRenderContext,
): string =>
  tokens.map((token) => renderToken(token, tight, context)).join("");

const renderToken = (
  token: Token,
  tight = false,
  context: HtmlRenderContext,
): string => {
  const children = (): string =>
    token.children
      ? renderTokens(token.children, false, context)
      : renderMarkdownText(token.content ?? "");
  switch (token.kind) {
    case "heading": {
      const level = token.level ?? 1;
      return `<h${level}>${children()}</h${level}>\n`;
    }
    case "paragraph":
      return tight ? `${children()}\n` : `<p>${children()}</p>\n`;
    case "fence": {
      const language = (token.info ?? "").trim().split(/\s+/u)[0] ?? "";
      const className = language
        ? ` class="language-${escapeHtml(language)}"`
        : "";
      return `<pre><code${className}>${escapeHtml(token.content ?? "")}</code></pre>\n`;
    }
    case "math_block":
      return `<div class="math math-block">${
        renderMath(token.content ?? "", true, context)
      }</div>\n`;
    case "code_block":
      return `<pre><code>${escapeHtml(token.content ?? "")}</code></pre>\n`;
    case "blockquote":
      return `<blockquote>\n${renderTokens(token.children ?? [], false, context)}</blockquote>\n`;
    case "bullet_list":
    case "ordered_list": {
      const tag = token.kind === "bullet_list" ? "ul" : "ol";
      const start =
        tag === "ol" && token.startNum && token.startNum !== 1
          ? ` start="${token.startNum}"`
          : "";
      return `<${tag}${start}>\n${(token.children ?? [])
        .map((child) => renderToken(child, token.tight ?? false, context))
        .join("")}</${tag}>\n`;
    }
    case "list_item": {
      const inner = renderTokens(token.children ?? [], tight, context);
      return tight
        ? `<li>${inner.replace(/\n$/u, "")}</li>\n`
        : `<li>\n${inner}</li>\n`;
    }
    case "hr":
      return "<hr />\n";
    case "strong":
      return `<strong>${children()}</strong>`;
    case "em":
      return `<em>${children()}</em>`;
    case "strikethrough": {
      const tag = token.markup === "~" ? "u" : "del";
      return `<${tag}>${children()}</${tag}>`;
    }
    case "code_inline":
      return `<code>${escapeHtml(token.content ?? "")}</code>`;
    case "math_inline":
      return `<span class="math math-inline">${
        renderMath(token.content ?? "", false, context)
      }</span>`;
    case "link": {
      const url = safeUrl(token.url ?? "");
      if (url === null) return children();
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<a href="${encodeUrl(url)}"${title}>${children()}</a>`;
    }
    case "image": {
      const alt = escapeHtml(
        token.children ? plainTokenText(token.children) : token.content ?? "",
      );
      const url = safeUrl(token.url ?? "");
      if (url === null) return alt;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      return `<img src="${encodeUrl(url)}" alt="${alt}"${title} />`;
    }
    case "autolink": {
      const url = safeUrl(token.url ?? "");
      return url === null
        ? escapeHtml(token.content ?? "")
        : `<a href="${encodeUrl(url)}">${escapeHtml(token.content ?? "")}</a>`;
    }
    case "table":
      return `<table>\n${renderTokens(token.children ?? [], false, context)}</table>\n`;
    case "table_head":
      return `<thead>\n${renderTokens(token.children ?? [], false, context)}</thead>\n`;
    case "table_body":
      return `<tbody>\n${renderTokens(token.children ?? [], false, context)}</tbody>\n`;
    case "table_header":
    case "table_row":
      return `<tr>\n${renderTokens(token.children ?? [], false, context)}</tr>\n`;
    case "table_header_cell":
    case "table_cell": {
      const tag = token.kind === "table_header_cell" ? "th" : "td";
      const align = typeof token.attrs?.align === "string"
        ? ` style="text-align:${token.attrs.align}"`
        : "";
      return `<${tag}${align}>${children()}</${tag}>\n`;
    }
    case "hardbreak":
      return "<br />\n";
    case "softbreak":
      return "\n";
    case "text":
      return renderMarkdownText(token.content ?? "");
    default:
      return children();
  }
};

export const renderMarkdownToHtml = (
  markdown: string,
  options: HtmlExportOptions = {},
): string => {
  const body = renderTokens(
    parseDocument(flowCliMarkdownParser, markdown).tokens,
    false,
    { macros: {} },
  );
  if (options.fragment) return body;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title ?? "Untitled")}</title>
  <style>${stylesheet}</style>
</head>
<body>
${body}</body>
</html>
`;
};

export const exportToHtmlString = renderMarkdownToHtml;

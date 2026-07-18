import { parseDocument, type Token } from "@saturn9/markoffset";
import { flowCliMarkdownParser } from "../presentation/parser.js";

export const exportToMarkdownString = (markdown: string): string => markdown;

const inlineText = (tokens: readonly Token[] = []): string =>
  tokens.map((token) => {
    switch (token.kind) {
      case "softbreak":
      case "hardbreak":
        return "\n";
      case "image": {
        const alt = token.children
          ? inlineText(token.children)
          : token.content ?? "";
        return alt ? `[Image: ${alt}]` : "";
      }
      default:
        return token.children
          ? inlineText(token.children)
          : (token.content ?? "").replace(
              /==(?:(?:🟩|🟥|🟦|🟧|🟪))?([^=]+?)==/gu,
              "$1",
            );
    }
  }).join("");

const blockText = (tokens: readonly Token[], depth = 0): string =>
  tokens.map((token) => {
    switch (token.kind) {
      case "heading":
      case "paragraph":
        return `${inlineText(token.children)}\n\n`;
      case "fence":
      case "math_block":
      case "code_block":
        return `${token.content ?? ""}\n`;
      case "blockquote":
        return blockText(token.children ?? [], depth)
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n";
      case "bullet_list":
      case "ordered_list":
        return (token.children ?? []).map((item, index) => {
          const marker = token.kind === "ordered_list"
            ? `${(token.startNum ?? 1) + index}. `
            : "- ";
          const text = blockText(item.children ?? [], depth + 1).trim();
          const indent = "  ".repeat(depth);
          return `${indent}${marker}${text.replace(/\n/gu, `\n${indent}  `)}`;
        }).join("\n") + "\n\n";
      case "hr":
        return "----------\n\n";
      case "table":
        return (token.children ?? [])
          .flatMap((section) => section.children ?? [])
          .map((row) =>
            (row.children ?? []).map((cell) => inlineText(cell.children)).join("\t")
          )
          .join("\n") + "\n\n";
      default:
        return token.children ? blockText(token.children, depth) : "";
    }
  }).join("");

export const markdownToPlainText = (markdown: string): string =>
  blockText(parseDocument(flowCliMarkdownParser, markdown).tokens)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

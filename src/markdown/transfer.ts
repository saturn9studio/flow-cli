import {
  absoluteOffset,
  normalizeRange,
  type TerminalEditor,
} from "../engine/index.js";
import { renderMarkdownToHtml } from "./export/html.js";
import { markdownToPlainText } from "./export/markdown.js";
import { buildMarkdownImage, buildMarkdownLink } from "./presentation/spans.js";

export interface TransferPayload {
  readonly plainText: string;
  readonly markdown: string;
  readonly html: string;
}

export interface TransferInput {
  readonly plainText?: string;
  readonly markdown?: string;
  readonly html?: string;
}

export type TransferHostEffect =
  | {
      readonly type: "writeTransfer";
      readonly payload: TransferPayload;
    }
  | {
      readonly type: "readTransfer";
      readonly accepted: readonly ["text/markdown", "text/html", "text/plain"];
    };

export const createTransferPayload = (markdown: string): TransferPayload => ({
  plainText: markdownToPlainText(markdown),
  markdown,
  html: renderMarkdownToHtml(markdown, { fragment: true }),
});

export const createWriteTransferEffect = (
  markdown: string,
): TransferHostEffect => ({
  type: "writeTransfer",
  payload: createTransferPayload(markdown),
});

export const createReadTransferEffect = (): TransferHostEffect => ({
  type: "readTransfer",
  accepted: ["text/markdown", "text/html", "text/plain"],
});

interface HtmlNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: HtmlNode[];
  readonly text?: string;
}

const decodeEntities = (value: string): string =>
  value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu,
    (_match, entity: string) => {
      const lower = entity.toLowerCase();
      const codePoint = lower.startsWith("#x")
        ? Number.parseInt(lower.slice(2), 16)
        : lower.startsWith("#")
          ? Number.parseInt(lower.slice(1), 10)
          : null;
      if (codePoint !== null) {
        return Number.isFinite(codePoint) &&
          codePoint >= 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
          ? String.fromCodePoint(codePoint)
          : "\ufffd";
      }
      return {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      }[lower] ?? "";
    },
  );

const parseAttributes = (source: string): Readonly<Record<string, string>> => {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(
    /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu,
  )) {
    attrs[(match[1] ?? "").toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return attrs;
};

const voidTags = new Set(["br", "hr", "img", "input", "meta", "link"]);

const parseHtml = (html: string): HtmlNode => {
  const root: HtmlNode = { tag: "root", attrs: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const pattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/gu;
  for (const match of html.matchAll(pattern)) {
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    if (!token.startsWith("<")) {
      stack.at(-1)?.children.push({
        tag: "#text",
        attrs: {},
        children: [],
        text: decodeEntities(token),
      });
      continue;
    }
    const close = token.match(/^<\s*\/\s*([A-Za-z0-9-]+)/u);
    if (close) {
      const tag = close[1]?.toLowerCase();
      let index = stack.length - 1;
      while (index > 0 && stack[index]?.tag !== tag) index -= 1;
      if (index > 0) stack.splice(index);
      continue;
    }
    const open = token.match(/^<\s*([A-Za-z0-9-]+)([\s\S]*?)\/?\s*>$/u);
    if (!open) continue;
    const tag = (open[1] ?? "").toLowerCase();
    const node: HtmlNode = {
      tag,
      attrs: parseAttributes(open[2] ?? ""),
      children: [],
    };
    stack.at(-1)?.children.push(node);
    if (!voidTags.has(tag) && !/\/\s*>$/u.test(token)) stack.push(node);
  }
  return root;
};

const rawText = (node: HtmlNode): string =>
  node.tag === "#text"
    ? node.text ?? ""
    : node.children.map(rawText).join("");

const strip = (value: string): string =>
  value
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

const escapeCell = (value: string): string =>
  value.replace(/\|/gu, "\\|").replace(/\n+/gu, "<br>");

const renderList = (node: HtmlNode, ordered: boolean, depth: number): string => {
  const start = Number(node.attrs.start ?? "1");
  return node.children
    .filter((child) => child.tag === "li")
    .map((item, index) => {
      const nested = item.children.filter(
        (child) => child.tag === "ul" || child.tag === "ol",
      );
      const direct = item.children.filter(
        (child) =>
          child.tag !== "ul" &&
          child.tag !== "ol" &&
          !(child.tag === "input" && child.attrs.type === "checkbox"),
      );
      const checkbox = item.children.find(
        (child) => child.tag === "input" && child.attrs.type === "checkbox",
      );
      const task = checkbox
        ? checkbox.attrs.checked !== undefined ? "[x] " : "[ ] "
        : "";
      const marker = ordered
        ? `${Number.isFinite(start) ? start + index : index + 1}. `
        : "- ";
      const indent = "  ".repeat(depth);
      const text = strip(direct.map((child) => nodeToMarkdown(child, depth)).join(""));
      const children = nested
        .map((child) => nodeToMarkdown(child, depth + 1))
        .join("\n");
      return `${indent}${marker}${task}${text}${children ? `\n${children}` : ""}`;
    })
    .join("\n");
};

const renderTable = (node: HtmlNode): string => {
  const rows = node.children
    .flatMap((child) => child.tag === "tr" ? [child] : child.children)
    .filter((child) => child.tag === "tr")
    .map((row) =>
      row.children
        .filter((cell) => cell.tag === "th" || cell.tag === "td")
        .map((cell) => escapeCell(strip(cell.children.map((child) =>
          nodeToMarkdown(child, 0)
        ).join("")))),
    );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) =>
    Array.from({ length: width }, (_value, index) => row[index] ?? "")
  );
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
};

const nodeToMarkdown = (node: HtmlNode, depth: number): string => {
  if (node.tag === "#text") return (node.text ?? "").replace(/\s+/gu, " ");
  const content = node.children.map((child) => nodeToMarkdown(child, depth)).join("");
  switch (node.tag) {
    case "root":
      return content;
    case "script":
    case "style":
      return "";
    case "br":
      return "\n";
    case "p":
    case "div":
    case "section":
      return `${strip(content)}\n\n`;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `${"#".repeat(Number(node.tag[1]))} ${strip(content)}\n\n`;
    case "strong":
    case "b":
      return `**${content}**`;
    case "em":
    case "i":
      return `*${content}*`;
    case "u":
      return `~${content}~`;
    case "s":
    case "del":
    case "strike":
      return `~~${content}~~`;
    case "mark":
      return `==${content}==`;
    case "code":
      return `\`${content}\``;
    case "pre": {
      const code = node.children.find((child) => child.tag === "code");
      const language = code?.attrs.class?.match(/(?:^|\s)language-([^\s]+)/u)?.[1] ?? "";
      return `\`\`\`${language}\n${rawText(code ?? node).replace(/\n$/u, "")}\n\`\`\`\n\n`;
    }
    case "a":
      return node.attrs.href
        ? buildMarkdownLink({
            text: strip(content) || node.attrs.href,
            url: node.attrs.href,
            title: node.attrs.title,
          })
        : content;
    case "img":
      return node.attrs.src
        ? buildMarkdownImage({
            src: node.attrs.src,
            alt: node.attrs.alt ?? "",
            title: node.attrs.title,
          })
        : "";
    case "blockquote":
      return `${strip(content).split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    case "ul":
      return `${renderList(node, false, depth)}${depth === 0 ? "\n\n" : ""}`;
    case "ol":
      return `${renderList(node, true, depth)}${depth === 0 ? "\n\n" : ""}`;
    case "hr":
      return "---\n\n";
    case "table":
      return `${renderTable(node)}\n\n`;
    default:
      return content;
  }
};

export const htmlToMarkdown = (html: string): string =>
  strip(nodeToMarkdown(parseHtml(html), 0));

export const markdownFromTransfer = (input: TransferInput): string =>
  input.markdown ??
  (input.html !== undefined ? htmlToMarkdown(input.html) : input.plainText ?? "");

export const selectedMarkdown = (editor: TerminalEditor): string => {
  const snapshot = editor.snapshot();
  const range = normalizeRange(snapshot.selection);
  return snapshot.content.slice(
    absoluteOffset(snapshot.doc, range.from),
    absoluteOffset(snapshot.doc, range.to),
  );
};

export const selectionTransferPayload = (
  editor: TerminalEditor,
): TransferPayload | null => {
  const markdown = selectedMarkdown(editor);
  return markdown.length > 0 ? createTransferPayload(markdown) : null;
};

export const applyTransfer = (
  editor: TerminalEditor,
  input: TransferInput,
): boolean => {
  const snapshot = editor.snapshot();
  if (snapshot.readOnly) return false;
  const markdown = markdownFromTransfer(input);
  editor.dispatch(
    editor.createTransaction().replaceSelection(markdown).build(),
  );
  return true;
};

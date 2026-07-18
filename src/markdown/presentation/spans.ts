import { parseDocument, type Token } from "@saturn9/markoffset";
import { flowCliMarkdownParser } from "./parser.js";

export interface MarkdownLinkSpan {
  readonly kind: "link" | "autolink";
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly url: string;
  readonly title?: string;
}

export interface MarkdownImageSpan {
  readonly from: number;
  readonly to: number;
  readonly alt: string;
  readonly src: string;
  readonly title?: string;
}

const escapeText = (value: string): string => value.replace(/([\\[\]])/gu, "\\$1");
const escapeDestination = (value: string): string =>
  /[\s()]/u.test(value) ? `<${value.replace(/>/gu, "\\>")}>` : value;
const escapeTitle = (value: string): string => value.replace(/(["\\])/gu, "\\$1");

const parseDestination = (
  raw: string,
): { readonly destination: string; readonly title?: string } => {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)(?:\s+["']([^"']*)["'])$/u);
  const destination = (match?.[1] ?? trimmed).trim();
  return {
    destination: destination.startsWith("<") && destination.endsWith(">")
      ? destination.slice(1, -1)
      : destination,
    title: match?.[2],
  };
};

const linkPattern = /\[((?:\\.|[^\]\\])*)\]\(([^)\n]*)\)|<((?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]+)|(?:[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+))>/gu;

export const buildMarkdownLink = (link: {
  readonly text: string;
  readonly url: string;
  readonly title?: string;
}): string => {
  const text = link.text.length > 0 ? link.text : link.url;
  if (text === link.url && !link.title) return `<${link.url}>`;
  const title = link.title ? ` "${escapeTitle(link.title)}"` : "";
  return `[${escapeText(text)}](${escapeDestination(link.url)}${title})`;
};

export const buildMarkdownImage = (image: {
  readonly alt?: string;
  readonly src: string;
  readonly title?: string;
}): string => {
  const title = image.title ? ` "${escapeTitle(image.title)}"` : "";
  return `![${escapeText(image.alt ?? "")}](${escapeDestination(image.src)}${title})`;
};

interface ImageToken {
  readonly token: Token;
  readonly owner: Token;
}

const imageTokens = (
  tokens: readonly Token[],
  owner?: Token,
): readonly ImageToken[] =>
  tokens.flatMap((token): readonly ImageToken[] => {
    const nextOwner = token.content === undefined ? owner : token;
    return [
      ...(token.kind === "image" && owner ? [{ token, owner }] : []),
      ...imageTokens(token.children ?? [], nextOwner),
    ];
  });

const contentOffsetMap = (
  source: string,
  content: string,
  from: number,
  to: number,
): readonly number[] | undefined => {
  const offsets: number[] = [];
  let sourceOffset = from;
  let contentOffset = 0;
  while (contentOffset < content.length) {
    const character = String.fromCodePoint(content.codePointAt(contentOffset) ?? 0);
    const found = source.indexOf(character, sourceOffset);
    if (found < 0 || found >= to) return undefined;
    for (let unit = 0; unit < character.length; unit += 1) {
      offsets[contentOffset + unit] = found + unit;
    }
    contentOffset += character.length;
    sourceOffset = found + character.length;
  }
  offsets[content.length] = sourceOffset;
  return offsets;
};

const imageSpansFromBlock = (
  source: string,
  block: Token,
): readonly MarkdownImageSpan[] =>
  imageTokens([block]).flatMap(({ token, owner }) => {
    const content = owner.content ?? "";
    const rangeFrom =
      owner.start >= block.start && owner.end <= block.end
        ? owner.start
        : block.start;
    const rangeTo =
      owner.start >= block.start && owner.end <= block.end
        ? owner.end
        : block.end;
    const offsets = contentOffsetMap(source, content, rangeFrom, rangeTo);
    const from = offsets?.[token.start];
    const last = token.end > token.start ? offsets?.[token.end - 1] : from;
    if (from === undefined || last === undefined) return [];
    return [{
      from,
      to: last + 1,
      alt: token.content ?? "",
      src: token.url ?? "",
      title: token.title,
    }];
  });

export const findMarkdownImages = (markdown: string): readonly MarkdownImageSpan[] =>
  parseDocument(flowCliMarkdownParser, markdown).tokens
    .flatMap((block) => imageSpansFromBlock(markdown, block))
    .filter((image) => image.src.length > 0);

export const findMarkdownLinks = (markdown: string): readonly MarkdownLinkSpan[] =>
  [...markdown.matchAll(linkPattern)].flatMap((match): readonly MarkdownLinkSpan[] => {
    const from = match.index ?? 0;
    if (from > 0 && markdown[from - 1] === "!") return [];
    if (match[3]) {
      const url = match[3];
      return [{
        kind: "autolink",
        from,
        to: from + match[0].length,
        text: url,
        url: /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(url)
          ? `mailto:${url}`
          : url,
      }];
    }
    const parsed = parseDestination(match[2] ?? "");
    return [{
      kind: "link",
      from,
      to: from + match[0].length,
      text: match[1] ?? "",
      url: parsed.destination,
      title: parsed.title,
    }];
  });

export const linkAtRange = (
  markdown: string,
  range: { readonly from: number; readonly to: number },
): MarkdownLinkSpan | null =>
  findMarkdownLinks(markdown).find(
    (link) => link.from <= range.from && link.to >= range.to,
  ) ?? null;

export const imageAtRange = (
  markdown: string,
  range: { readonly from: number; readonly to: number },
): MarkdownImageSpan | null =>
  findMarkdownImages(markdown).find(
    (image) => image.from <= range.from && image.to >= range.to,
  ) ?? null;

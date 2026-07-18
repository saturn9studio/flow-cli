import {
  createParser,
  type BlockRule,
  type BlockScanner,
  type InlineContext,
  type InlineRule,
} from "@saturn9/markoffset";
import {
  createBlockquoteRule,
  createListRule,
  createTableRule,
  heading,
  hr,
} from "@saturn9/markoffset/plugins/block";
import {
  autolink,
  codeInline,
  emAsteriskDelimiter,
  emUnderscoreDelimiter,
  hardbreak,
  image,
  link,
  strikethrough,
  strikethroughDouble,
  strongAsteriskDelimiter,
  strongUnderscoreDelimiter,
} from "@saturn9/markoffset/plugins/inline";
import { createLinkReferenceExtension } from "@saturn9/markoffset/plugins/references";

const maxFenceIndent = 3;
const backtick = 96;
const tilde = 126;
const dollar = 36;

const leadingSpaces = (line: string): number => {
  let index = 0;
  while (
    index < maxFenceIndent &&
    index < line.length &&
    line.charCodeAt(index) === 32
  ) {
    index += 1;
  }
  return index;
};

export const flowCliMarkdownFencePrefix = (
  line: string,
): { readonly indent: number; readonly char: number; readonly length: number } | null => {
  const indent = leadingSpaces(line);
  const char = line.charCodeAt(indent);
  if (char !== backtick && char !== tilde) return null;

  let length = 0;
  while (
    indent + length < line.length &&
    line.charCodeAt(indent + length) === char
  ) {
    length += 1;
  }
  if (length < 3) return null;
  if (char === backtick && line.slice(indent + length).includes("`")) return null;
  return { indent, char, length };
};

const blankFrom = (line: string, start: number): boolean => {
  for (let index = start; index < line.length; index += 1) {
    const char = line.charCodeAt(index);
    if (char !== 32 && char !== 9) return false;
  }
  return true;
};

export const flowCliMarkdownClosingFenceLine = (
  line: string,
  opening: { readonly char: number; readonly length: number },
): boolean => {
  const indent = leadingSpaces(line);
  let length = 0;
  while (
    indent + length < line.length &&
    line.charCodeAt(indent + length) === opening.char
  ) {
    length += 1;
  }
  return length >= opening.length && blankFrom(line, indent + length);
};

const hasClosingFence = (
  scanner: BlockScanner,
  opening: { readonly char: number; readonly length: number },
): boolean => {
  let lineStart = scanner.currentLineEnd() + 1;
  while (lineStart < scanner.src.length) {
    const lineEnd = scanner.src.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? scanner.src.length : lineEnd;
    if (flowCliMarkdownClosingFenceLine(scanner.src.slice(lineStart, end), opening)) {
      return true;
    }
    lineStart = end + 1;
  }
  return false;
};

const stripOpeningIndent = (line: string, indent: number): string => {
  let spaces = 0;
  while (spaces < indent && spaces < line.length && line.charCodeAt(spaces) === 32) {
    spaces += 1;
  }
  return line.slice(spaces);
};

const closedFence: BlockRule = {
  name: "closed-fence",
  priority: 100,
  startChars: "`~",
  match(line, scanner) {
    const opening = flowCliMarkdownFencePrefix(line);
    return opening !== null && hasClosingFence(scanner, opening);
  },
  parse(scanner) {
    const line = scanner.currentLine();
    const start = scanner.currentLineStart();
    const opening = flowCliMarkdownFencePrefix(line);
    if (opening === null) {
      throw new Error("closed-fence parse called for a non-fence line");
    }

    const info = line.slice(opening.indent + opening.length).trim()
      .replace(/\\([!-/:-@[-`{-~])/gu, "$1");
    scanner.advance();

    let content = "";
    let end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start;
    while (!scanner.atEnd()) {
      const current = scanner.currentLine();
      if (flowCliMarkdownClosingFenceLine(current, opening)) {
        end = scanner.currentLineEnd();
        scanner.advance();
        break;
      }
      content += `${stripOpeningIndent(current, opening.indent)}\n`;
      end = scanner.currentLineEnd();
      scanner.advance();
    }

    return {
      kind: "fence",
      start,
      end,
      info,
      content,
      markup: String.fromCharCode(opening.char).repeat(opening.length),
    };
  },
};

export interface FlowCliMarkdownMathBlock {
  readonly from: number;
  readonly to: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly openingMarkerFrom: number;
  readonly openingMarkerTo: number;
  readonly closingMarkerFrom: number;
  readonly closingMarkerTo: number;
  readonly content: string;
}

export interface FlowCliMarkdownInlineMath {
  readonly from: number;
  readonly to: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly content: string;
}

export interface FlowCliMarkdownFence {
  readonly from: number;
  readonly to: number;
}

export const findFlowCliMarkdownFences = (
  source: string,
): readonly FlowCliMarkdownFence[] => {
  const fences: FlowCliMarkdownFence[] = [];
  let lineStart = 0;
  while (lineStart < source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? source.length : lineEnd;
    const opening = flowCliMarkdownFencePrefix(source.slice(lineStart, end));
    if (opening === null) {
      lineStart = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }

    let foundClosing = false;
    let closeLineStart = lineEnd === -1 ? source.length : lineEnd + 1;
    while (closeLineStart < source.length) {
      const closeLineEnd = source.indexOf("\n", closeLineStart);
      const closeEnd = closeLineEnd === -1 ? source.length : closeLineEnd;
      if (
        flowCliMarkdownClosingFenceLine(
          source.slice(closeLineStart, closeEnd),
          opening,
        )
      ) {
        fences.push({ from: lineStart, to: closeEnd });
        lineStart = closeLineEnd === -1 ? source.length : closeLineEnd + 1;
        foundClosing = true;
        break;
      }
      closeLineStart = closeLineEnd === -1 ? source.length : closeLineEnd + 1;
    }
    if (!foundClosing) {
      lineStart = lineEnd === -1 ? source.length : lineEnd + 1;
    }
  }
  return fences;
};

const isEscaped = (source: string, index: number): boolean => {
  let backslashes = 0;
  for (let current = index - 1; current >= 0 && source[current] === "\\"; current -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const isWhitespace = (source: string, index: number): boolean =>
  /\s/u.test(source[index] ?? "");

const findInlineMathClosingDollar = (
  source: string,
  bodyFrom: number,
  end: number,
): number => {
  const newline = source.indexOf("\n", bodyFrom);
  const limit = newline === -1 || newline > end ? end : newline;
  let searchFrom = bodyFrom;
  while (searchFrom < limit) {
    const closing = source.indexOf("$", searchFrom);
    if (closing === -1 || closing >= limit) return -1;
    if (
      closing > bodyFrom &&
      !isEscaped(source, closing) &&
      source.charCodeAt(closing + 1) !== dollar &&
      !isWhitespace(source, bodyFrom) &&
      !isWhitespace(source, closing - 1)
    ) {
      return closing;
    }
    searchFrom = closing + 1;
  }
  return -1;
};

const mathInline: InlineRule = {
  name: "math_inline",
  triggers: [dollar],
  requiredChars: "$",
  bindingPower: 10,
  mayStart(source: string, position: number, end: number): boolean {
    return position + 1 < end &&
      source.charCodeAt(position + 1) !== dollar &&
      !isEscaped(source, position);
  },
  nud(context: InlineContext) {
    const start = context.pos;
    const bodyFrom = start + 1;
    const closing = findInlineMathClosingDollar(context.src, bodyFrom, context.end);
    if (closing === -1) return null;
    context.pos = closing + 1;
    return {
      kind: "math_inline",
      start,
      end: context.pos,
      content: context.src.slice(bodyFrom, closing),
      markup: "$",
    };
  },
};

export const findFlowCliMarkdownInlineMath = (
  source: string,
): readonly FlowCliMarkdownInlineMath[] => {
  const ranges: FlowCliMarkdownInlineMath[] = [];
  let position = 0;
  while (position < source.length) {
    const opening = source.indexOf("$", position);
    if (opening === -1) break;
    const bodyFrom = opening + 1;
    if (
      bodyFrom >= source.length ||
      source.charCodeAt(bodyFrom) === dollar ||
      isEscaped(source, opening)
    ) {
      position = bodyFrom;
      continue;
    }
    const closing = findInlineMathClosingDollar(source, bodyFrom, source.length);
    if (closing === -1) {
      position = bodyFrom;
      continue;
    }
    ranges.push({
      from: opening,
      to: closing + 1,
      bodyFrom,
      bodyTo: closing,
      content: source.slice(bodyFrom, closing),
    });
    position = closing + 1;
  }
  return ranges;
};

const mathBlockDelimiter = (line: string): { readonly indent: number } | null => {
  const indent = leadingSpaces(line);
  return line.charCodeAt(indent) === dollar &&
      line.charCodeAt(indent + 1) === dollar &&
      blankFrom(line, indent + 2)
    ? { indent }
    : null;
};

const hasClosingMathBlock = (scanner: BlockScanner): boolean => {
  let lineStart = scanner.currentLineEnd() + 1;
  while (lineStart < scanner.src.length) {
    const lineEnd = scanner.src.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? scanner.src.length : lineEnd;
    if (mathBlockDelimiter(scanner.src.slice(lineStart, end)) !== null) return true;
    lineStart = end + 1;
  }
  return false;
};

const mathBlock: BlockRule = {
  name: "math-block",
  priority: 100,
  startChars: "$",
  match(line, scanner) {
    return mathBlockDelimiter(line) !== null && hasClosingMathBlock(scanner);
  },
  parse(scanner) {
    const line = scanner.currentLine();
    const start = scanner.currentLineStart();
    const opening = mathBlockDelimiter(line);
    if (opening === null) {
      throw new Error("math-block parse called for a non-math-block line");
    }
    scanner.advance();

    let content = "";
    let end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start;
    while (!scanner.atEnd()) {
      const current = scanner.currentLine();
      if (mathBlockDelimiter(current) !== null) {
        end = scanner.currentLineEnd();
        scanner.advance();
        break;
      }
      content += `${current}\n`;
      end = scanner.currentLineEnd();
      scanner.advance();
    }

    return {
      kind: "math_block",
      start,
      end,
      content,
      markup: "$$",
    };
  },
};

export const findFlowCliMarkdownMathBlocks = (
  source: string,
): readonly FlowCliMarkdownMathBlock[] => {
  const blocks: FlowCliMarkdownMathBlock[] = [];
  let lineStart = 0;
  while (lineStart < source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? source.length : lineEnd;
    const opening = mathBlockDelimiter(source.slice(lineStart, end));
    if (opening === null) {
      lineStart = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }

    let closeLineStart = lineEnd === -1 ? source.length : lineEnd + 1;
    while (closeLineStart < source.length) {
      const closeLineEnd = source.indexOf("\n", closeLineStart);
      const closeEnd = closeLineEnd === -1 ? source.length : closeLineEnd;
      const closing = mathBlockDelimiter(source.slice(closeLineStart, closeEnd));
      if (closing !== null) {
        const bodyFrom = lineEnd === -1 ? end : lineEnd + 1;
        blocks.push({
          from: lineStart,
          to: closeEnd,
          bodyFrom,
          bodyTo: closeLineStart,
          openingMarkerFrom: lineStart + opening.indent,
          openingMarkerTo: lineStart + opening.indent + 2,
          closingMarkerFrom: closeLineStart + closing.indent,
          closingMarkerTo: closeLineStart + closing.indent + 2,
          content: source.slice(bodyFrom, closeLineStart),
        });
        lineStart = closeLineEnd === -1 ? source.length : closeLineEnd + 1;
        break;
      }
      closeLineStart = closeLineEnd === -1 ? source.length : closeLineEnd + 1;
    }
    if (closeLineStart >= source.length) {
      lineStart = source.length;
    }
  }
  return blocks;
};

export const flowCliMarkdownInlineRules = [
  strongAsteriskDelimiter,
  emAsteriskDelimiter,
  strongUnderscoreDelimiter,
  emUnderscoreDelimiter,
  strikethroughDouble,
  strikethrough,
  codeInline,
  mathInline,
  image,
  link,
  autolink,
  hardbreak,
];

export const flowCliMarkdownParser = createParser({
  block: [
    heading,
    closedFence,
    mathBlock,
    hr,
    createBlockquoteRule(),
    createListRule(),
    createTableRule(),
  ],
  inline: flowCliMarkdownInlineRules,
  extensions: [createLinkReferenceExtension()],
});

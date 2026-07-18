import hljs from "highlight.js";
import type { TextStyle, WidgetTextRun } from "../engine/index.js";

const syntaxRoles: Readonly<Record<string, string>> = {
  attribute: "codeSyntax.attribute",
  built_in: "codeSyntax.builtIn",
  bullet: "codeSyntax.symbol",
  class: "codeSyntax.type",
  comment: "codeSyntax.comment",
  doctag: "codeSyntax.meta",
  function: "codeSyntax.function",
  keyword: "codeSyntax.keyword",
  literal: "codeSyntax.literal",
  meta: "codeSyntax.meta",
  number: "codeSyntax.number",
  operator: "codeSyntax.operator",
  params: "codeSyntax.params",
  property: "codeSyntax.property",
  regexp: "codeSyntax.regexp",
  selector_attr: "codeSyntax.attribute",
  selector_class: "codeSyntax.type",
  selector_id: "codeSyntax.type",
  selector_tag: "codeSyntax.keyword",
  string: "codeSyntax.string",
  subst: "codeSyntax.text",
  symbol: "codeSyntax.symbol",
  tag: "codeSyntax.keyword",
  template_tag: "codeSyntax.keyword",
  template_variable: "codeSyntax.variable",
  title: "codeSyntax.function",
  type: "codeSyntax.type",
  variable: "codeSyntax.variable",
};

const decodeHtml = (value: string): string =>
  value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu,
    (_match, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
      }
      if (normalized.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
      }
      return {
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        quot: '"',
      }[normalized] ?? "";
    },
  );

const styleForClasses = (classes: string): TextStyle => {
  const scope = classes
    .split(/\s+/u)
    .find((className) => className.startsWith("hljs-"))
    ?.slice("hljs-".length);
  return { role: scope ? syntaxRoles[scope] ?? "markdownCode" : "markdownCode" };
};

const appendRun = (
  lines: WidgetTextRun[][],
  text: string,
  style: TextStyle,
): void => {
  const parts = decodeHtml(text).split("\n");
  parts.forEach((part, index) => {
    if (part) {
      const line = lines.at(-1)!;
      const previous = line.at(-1);
      if (previous && previous.style?.role === style.role) {
        line[line.length - 1] = { ...previous, text: previous.text + part };
      } else {
        line.push({ text: part, style });
      }
    }
    if (index < parts.length - 1) lines.push([]);
  });
};

const highlightedRuns = (html: string): readonly (readonly WidgetTextRun[])[] => {
  const lines: WidgetTextRun[][] = [[]];
  const styles: TextStyle[] = [{ role: "markdownCode" }];
  const tokens = /<span class="([^"]*)">|<\/span>|([^<]+)/gu;
  for (const match of html.matchAll(tokens)) {
    if (match[1] !== undefined) {
      styles.push(styleForClasses(match[1]));
    } else if (match[0] === "</span>") {
      if (styles.length > 1) styles.pop();
    } else if (match[2] !== undefined) {
      appendRun(lines, match[2], styles.at(-1)!);
    }
  }
  return lines;
};

export const highlightCode = (
  code: string,
  language: string,
): readonly (readonly WidgetTextRun[])[] => {
  const normalizedLanguage = language.trim().toLowerCase();
  if (!normalizedLanguage || !hljs.getLanguage(normalizedLanguage)) {
    return code.split("\n").map((text) => [{
      text,
      style: { role: "markdownCode" },
    }]);
  }
  return highlightedRuns(
    hljs.highlight(code, {
      language: normalizedLanguage,
      ignoreIllegals: true,
    }).value,
  );
};

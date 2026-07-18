export interface Paragraph {
  readonly text: string;
}

export interface EditorDocument {
  readonly paragraphs: readonly Paragraph[];
}

export interface Position {
  readonly paragraph: number;
  readonly offset: number;
}

export interface Selection {
  readonly anchor: Position;
  readonly head: Position;
}

export interface Range {
  readonly from: Position;
  readonly to: Position;
}

interface Segment {
  readonly index: number;
  readonly segment: string;
}

interface SegmenterLike {
  segment(input: string): Iterable<Segment>;
}

type IntlWithSegmenter = typeof Intl & {
  Segmenter?: new (
    locale?: string | string[],
    options?: { granularity: "grapheme" },
  ) => SegmenterLike;
};

const segmenter = (Intl as IntlWithSegmenter).Segmenter
  ? new (Intl as IntlWithSegmenter).Segmenter!(undefined, {
      granularity: "grapheme",
    })
  : null;

export const paragraph = (text = ""): Paragraph => ({ text });

export const createDocument = (
  paragraphs: readonly Paragraph[] = [paragraph()],
): EditorDocument => ({
  paragraphs: paragraphs.length > 0 ? [...paragraphs] : [paragraph()],
});

export const documentFromText = (text: string): EditorDocument =>
  createDocument(text.replace(/\r\n?/gu, "\n").split("\n").map(paragraph));

export const documentToText = (doc: EditorDocument): string =>
  doc.paragraphs.map((item) => item.text).join("\n");

export const comparePositions = (a: Position, b: Position): number =>
  a.paragraph === b.paragraph ? a.offset - b.offset : a.paragraph - b.paragraph;

export const isSamePosition = (a: Position, b: Position): boolean =>
  comparePositions(a, b) === 0;

export const selectionIsCollapsed = (selection: Selection): boolean =>
  isSamePosition(selection.anchor, selection.head);

export const normalizeRange = (selection: Selection): Range =>
  comparePositions(selection.anchor, selection.head) <= 0
    ? { from: selection.anchor, to: selection.head }
    : { from: selection.head, to: selection.anchor };

export const rangesIntersect = (a: Range, b: Range): boolean =>
  comparePositions(a.from, b.to) <= 0 && comparePositions(b.from, a.to) <= 0;

export const positionInRange = (position: Position, range: Range): boolean =>
  comparePositions(position, range.from) >= 0 &&
  comparePositions(position, range.to) <= 0;

export const collapsedSelection = (position: Position): Selection => ({
  anchor: position,
  head: position,
});

export const firstPosition = (): Position => ({ paragraph: 0, offset: 0 });

export const lastPosition = (doc: EditorDocument): Position => {
  const paragraphIndex = Math.max(0, doc.paragraphs.length - 1);
  return {
    paragraph: paragraphIndex,
    offset: doc.paragraphs[paragraphIndex]?.text.length ?? 0,
  };
};

export const clampPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const paragraphIndex = Math.min(
    Math.max(position.paragraph, 0),
    Math.max(0, doc.paragraphs.length - 1),
  );
  const item = doc.paragraphs[paragraphIndex] ?? paragraph();
  return {
    paragraph: paragraphIndex,
    offset: Math.min(Math.max(position.offset, 0), item.text.length),
  };
};

export const clampSelection = (
  doc: EditorDocument,
  selection: Selection,
): Selection => ({
  anchor: clampPosition(doc, selection.anchor),
  head: clampPosition(doc, selection.head),
});

export const absoluteOffset = (
  doc: EditorDocument,
  position: Position,
): number => {
  const clamped = clampPosition(doc, position);
  return doc.paragraphs
    .slice(0, clamped.paragraph)
    .reduce((total, item) => total + item.text.length + 1, clamped.offset);
};

export const positionFromOffset = (
  doc: EditorDocument,
  offset: number,
): Position => {
  let remaining = Math.max(0, offset);
  for (let index = 0; index < doc.paragraphs.length; index += 1) {
    const item = doc.paragraphs[index];
    if (remaining <= item.text.length) {
      return { paragraph: index, offset: remaining };
    }
    remaining -= item.text.length + 1;
  }
  return lastPosition(doc);
};

export const textInRange = (doc: EditorDocument, range: Range): string => {
  const normalized = normalizeRange({ anchor: range.from, head: range.to });
  return documentToText(doc).slice(
    absoluteOffset(doc, normalized.from),
    absoluteOffset(doc, normalized.to),
  );
};

export const graphemeSegments = (text: string): readonly Segment[] => {
  if (segmenter) return [...segmenter.segment(text)];
  const segments: Segment[] = [];
  let index = 0;
  for (const value of text) {
    segments.push({ index, segment: value });
    index += value.length;
  }
  return segments;
};

export const previousGraphemeOffset = (text: string, offset: number): number => {
  const target = Math.max(0, Math.min(offset, text.length));
  if (target === 0) return 0;
  let previous = 0;
  for (const item of graphemeSegments(text)) {
    if (item.index >= target) break;
    previous = item.index;
  }
  return previous;
};

export const nextGraphemeOffset = (text: string, offset: number): number => {
  const target = Math.max(0, Math.min(offset, text.length));
  if (target === text.length) return text.length;
  for (const item of graphemeSegments(text)) {
    const end = item.index + item.segment.length;
    if (end > target) return end;
  }
  return text.length;
};

const isWhitespace = (text: string): boolean => /\s/u.test(text);

export const previousWordOffset = (text: string, offset: number): number => {
  let current = Math.max(0, Math.min(offset, text.length));
  if (current === 0) return 0;
  let previous = previousGraphemeOffset(text, current);
  while (current > 0 && isWhitespace(text.slice(previous, current))) {
    current = previous;
    previous = previousGraphemeOffset(text, current);
  }
  while (current > 0) {
    previous = previousGraphemeOffset(text, current);
    if (isWhitespace(text.slice(previous, current))) break;
    current = previous;
  }
  return current;
};

export const nextWordOffset = (text: string, offset: number): number => {
  let current = Math.max(0, Math.min(offset, text.length));
  if (current === text.length) return text.length;
  let next = nextGraphemeOffset(text, current);
  while (current < text.length && isWhitespace(text.slice(current, next))) {
    current = next;
    next = nextGraphemeOffset(text, current);
  }
  while (current < text.length) {
    next = nextGraphemeOffset(text, current);
    if (isWhitespace(text.slice(current, next))) break;
    current = next;
  }
  return current;
};

export const previousPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const current = clampPosition(doc, position);
  const item = doc.paragraphs[current.paragraph] ?? paragraph();
  if (current.offset > 0) {
    return {
      paragraph: current.paragraph,
      offset: previousGraphemeOffset(item.text, current.offset),
    };
  }
  if (current.paragraph === 0) return current;
  const previous = doc.paragraphs[current.paragraph - 1] ?? paragraph();
  return { paragraph: current.paragraph - 1, offset: previous.text.length };
};

export const nextPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const current = clampPosition(doc, position);
  const item = doc.paragraphs[current.paragraph] ?? paragraph();
  if (current.offset < item.text.length) {
    return {
      paragraph: current.paragraph,
      offset: nextGraphemeOffset(item.text, current.offset),
    };
  }
  if (current.paragraph >= doc.paragraphs.length - 1) return current;
  return { paragraph: current.paragraph + 1, offset: 0 };
};

export const previousWordPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const current = clampPosition(doc, position);
  const item = doc.paragraphs[current.paragraph] ?? paragraph();
  if (current.offset > 0) {
    return {
      paragraph: current.paragraph,
      offset: previousWordOffset(item.text, current.offset),
    };
  }
  if (current.paragraph === 0) return current;
  const previous = doc.paragraphs[current.paragraph - 1] ?? paragraph();
  return { paragraph: current.paragraph - 1, offset: previous.text.length };
};

export const nextWordPosition = (
  doc: EditorDocument,
  position: Position,
): Position => {
  const current = clampPosition(doc, position);
  const item = doc.paragraphs[current.paragraph] ?? paragraph();
  if (current.offset < item.text.length) {
    return {
      paragraph: current.paragraph,
      offset: nextWordOffset(item.text, current.offset),
    };
  }
  if (current.paragraph >= doc.paragraphs.length - 1) return current;
  return { paragraph: current.paragraph + 1, offset: 0 };
};

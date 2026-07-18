import {
  type EditorDocument,
  type Paragraph,
  type Position,
  type Selection,
  absoluteOffset,
  clampPosition,
  clampSelection,
  collapsedSelection,
  createDocument,
  normalizeRange,
  paragraph,
} from "./model.js";
import {
  type TransactionMetaKey,
  type TransactionMetaStore,
  emptyTransactionMeta,
} from "./metadata.js";

export type Step =
  | {
      readonly kind: "replaceRange";
      readonly from: Position;
      readonly to: Position;
      readonly text: string;
    }
  | {
      readonly kind: "setSelection";
      readonly selection: Selection;
    };

export interface DisplayChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface Transaction {
  readonly steps: readonly Step[];
  readonly displayChanges: readonly DisplayChange[];
  readonly docBefore: EditorDocument;
  readonly docAfter: EditorDocument;
  readonly selectionBefore: Selection;
  readonly selectionAfter: Selection;
  readonly meta: TransactionMetaStore;
}

const applyReplaceRange = (
  doc: EditorDocument,
  step: Extract<Step, { kind: "replaceRange" }>,
): { doc: EditorDocument; selection: Selection } => {
  const range = normalizeRange({
    anchor: clampPosition(doc, step.from),
    head: clampPosition(doc, step.to),
  });
  const start = doc.paragraphs[range.from.paragraph] ?? paragraph();
  const end = doc.paragraphs[range.to.paragraph] ?? paragraph();
  const prefix = start.text.slice(0, range.from.offset);
  const suffix = end.text.slice(range.to.offset);
  const inserted = step.text.replace(/\r\n?/gu, "\n").split("\n");
  const replacement: Paragraph[] =
    inserted.length === 1
      ? [paragraph(`${prefix}${inserted[0]}${suffix}`)]
      : [
          paragraph(`${prefix}${inserted[0]}`),
          ...inserted.slice(1, -1).map(paragraph),
          paragraph(`${inserted.at(-1) ?? ""}${suffix}`),
        ];
  const nextDoc = createDocument([
    ...doc.paragraphs.slice(0, range.from.paragraph),
    ...replacement,
    ...doc.paragraphs.slice(range.to.paragraph + 1),
  ]);
  const nextPosition: Position = {
    paragraph: range.from.paragraph + inserted.length - 1,
    offset:
      inserted.length === 1
        ? prefix.length + inserted[0].length
        : (inserted.at(-1) ?? "").length,
  };
  return {
    doc: nextDoc,
    selection: collapsedSelection(clampPosition(nextDoc, nextPosition)),
  };
};

export const applyStep = (
  doc: EditorDocument,
  step: Step,
): { doc: EditorDocument; selection: Selection } => {
  switch (step.kind) {
    case "replaceRange":
      return applyReplaceRange(doc, step);
    case "setSelection":
      return { doc, selection: clampSelection(doc, step.selection) };
  }
};

export class TransactionBuilder {
  private readonly steps: Step[] = [];
  private readonly displayChanges: DisplayChange[] = [];
  private nextDoc: EditorDocument;
  private nextSelection: Selection;
  private metaStore = emptyTransactionMeta;

  constructor(
    private readonly docBefore: EditorDocument,
    private readonly selectionBefore: Selection,
  ) {
    this.nextDoc = docBefore;
    this.nextSelection = selectionBefore;
  }

  replaceRange(from: Position, to: Position, text: string): this {
    const range = normalizeRange({
      anchor: clampPosition(this.nextDoc, from),
      head: clampPosition(this.nextDoc, to),
    });
    const step: Step = { kind: "replaceRange", from, to, text };
    const next = applyStep(this.nextDoc, step);
    this.steps.push(step);
    this.displayChanges.push({
      from: absoluteOffset(this.nextDoc, range.from),
      to: absoluteOffset(this.nextDoc, range.to),
      insert: text,
    });
    this.nextDoc = next.doc;
    this.nextSelection = next.selection;
    return this;
  }

  replaceSelection(text: string): this {
    const range = normalizeRange(this.nextSelection);
    return this.replaceRange(range.from, range.to, text);
  }

  setSelection(selection: Selection): this {
    const step: Step = { kind: "setSelection", selection };
    const next = applyStep(this.nextDoc, step);
    this.steps.push(step);
    this.nextSelection = next.selection;
    return this;
  }

  setMeta<T>(key: TransactionMetaKey<T>, value: T): this {
    this.metaStore = this.metaStore.set(key, value);
    return this;
  }

  get doc(): EditorDocument {
    return this.nextDoc;
  }

  get selection(): Selection {
    return this.nextSelection;
  }

  build(): Transaction {
    return {
      steps: [...this.steps],
      displayChanges: [...this.displayChanges],
      docBefore: this.docBefore,
      docAfter: this.nextDoc,
      selectionBefore: this.selectionBefore,
      selectionAfter: this.nextSelection,
      meta: this.metaStore,
    };
  }
}

export const createTransaction = (
  doc: EditorDocument,
  selection: Selection,
): TransactionBuilder => new TransactionBuilder(doc, selection);

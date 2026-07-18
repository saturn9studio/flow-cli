import { createTransactionMetaKey, emptyTransactionMeta } from "./metadata.js";
import type { EditorDocument, Selection } from "./model.js";
import type { SyntaxSnapshot } from "./syntax.js";
import type { DisplayChange, Transaction } from "./transaction.js";

export type HistoryEvent =
  | { readonly kind: "typing"; readonly text: string }
  | { readonly kind: "deleteBackward" }
  | { readonly kind: "deleteForward" }
  | { readonly kind: "widgetEdit"; readonly source: string }
  | { readonly kind: "boundary" };

export const historyEventMetaKey =
  createTransactionMetaKey<HistoryEvent>("historyEvent");

export interface HistorySnapshot {
  readonly doc: EditorDocument;
  readonly selection: Selection;
  readonly content: string;
  readonly syntax: SyntaxSnapshot;
}

export interface HistoryEntry {
  readonly before: HistorySnapshot;
  readonly after: HistorySnapshot;
}

export interface HistoryRestore {
  readonly snapshot: HistorySnapshot;
  readonly transaction: Transaction;
}

type BatchKind = "typing" | "deleteBackward" | "deleteForward" | `widgetEdit:${string}`;

interface HistoryRecord extends HistoryEntry {
  readonly batch?: { readonly kind: BatchKind; readonly updatedAt: number; readonly open: boolean };
}

const fullDocumentChange = (
  before: HistorySnapshot,
  after: HistorySnapshot,
): readonly DisplayChange[] =>
  before.content === after.content
    ? []
    : [{ from: 0, to: before.content.length, insert: after.content }];

const restoreTransaction = (
  before: HistorySnapshot,
  after: HistorySnapshot,
): Transaction => ({
  steps: [],
  displayChanges: fullDocumentChange(before, after),
  docBefore: before.doc,
  docAfter: after.doc,
  selectionBefore: before.selection,
  selectionAfter: after.selection,
  meta: emptyTransactionMeta,
});

export class EditorHistory {
  private readonly undoStack: HistoryRecord[] = [];
  private readonly redoStack: HistoryRecord[] = [];

  constructor(
    private readonly limit = 100,
    private readonly mergeWindowMs = 1500,
  ) {}

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(
    entry: HistoryEntry,
    event: HistoryEvent = { kind: "boundary" },
    timestamp = Date.now(),
  ): void {
    const batch = this.batchForEvent(event, timestamp);
    const previous = this.undoStack.at(-1);
    if (
      previous?.batch?.open &&
      batch &&
      previous.batch.kind === batch.kind &&
      timestamp - previous.batch.updatedAt <= this.mergeWindowMs
    ) {
      this.undoStack[this.undoStack.length - 1] = {
        ...previous,
        after: entry.after,
        batch: { ...batch, open: batch.open && !this.closesBatch(event) },
      };
    } else {
      this.undoStack.push({
        ...entry,
        batch: batch
          ? { ...batch, open: batch.open && !this.closesBatch(event) }
          : undefined,
      });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  undo(): HistoryRestore | null {
    this.closeBatch();
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(this.closed(entry));
    return {
      snapshot: entry.before,
      transaction: restoreTransaction(entry.after, entry.before),
    };
  }

  redo(): HistoryRestore | null {
    this.closeBatch();
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(this.closed(entry));
    return {
      snapshot: entry.after,
      transaction: restoreTransaction(entry.before, entry.after),
    };
  }

  reset(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  closeBatch(): void {
    const entry = this.undoStack.at(-1);
    if (entry?.batch?.open) this.undoStack[this.undoStack.length - 1] = this.closed(entry);
  }

  private batchForEvent(event: HistoryEvent, timestamp: number) {
    switch (event.kind) {
      case "typing":
      case "deleteBackward":
      case "deleteForward":
        return { kind: event.kind, updatedAt: timestamp, open: true } as const;
      case "widgetEdit":
        return {
          kind: `widgetEdit:${event.source}` as const,
          updatedAt: timestamp,
          open: true,
        };
      case "boundary":
        return undefined;
    }
  }

  private closesBatch(event: HistoryEvent): boolean {
    return event.kind === "typing" && /\s/u.test(event.text);
  }

  private closed(entry: HistoryRecord): HistoryRecord {
    return entry.batch
      ? { ...entry, batch: { ...entry.batch, open: false } }
      : entry;
  }
}

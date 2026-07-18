import type { EditorDocument } from "./model.js";
import type { DisplayChange } from "./transaction.js";

export interface SyntaxSnapshot {
  readonly kind: string;
  readonly version: number;
}

export interface SyntaxProvider {
  create(doc: EditorDocument): SyntaxSnapshot;
  update(
    previous: SyntaxSnapshot,
    doc: EditorDocument,
    displayChanges: readonly DisplayChange[],
  ): SyntaxSnapshot;
}

export const emptySyntaxSnapshot: SyntaxSnapshot = Object.freeze({
  kind: "none",
  version: 0,
});

export const emptySyntaxProvider: SyntaxProvider = {
  create: () => emptySyntaxSnapshot,
  update: (previous) => previous,
};

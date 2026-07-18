export class TransactionMetaKey<T> {
  readonly value?: T;

  constructor(readonly name: string) {}
}

export class TransactionMetaStore {
  private constructor(private readonly values: ReadonlyMap<TransactionMetaKey<unknown>, unknown>) {}

  static empty(): TransactionMetaStore {
    return new TransactionMetaStore(new Map());
  }

  get<T>(key: TransactionMetaKey<T>): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: TransactionMetaKey<T>, value: T): TransactionMetaStore {
    const next = new Map(this.values);
    next.set(key as TransactionMetaKey<unknown>, value);
    return new TransactionMetaStore(next);
  }
}

export const createTransactionMetaKey = <T>(name: string): TransactionMetaKey<T> =>
  new TransactionMetaKey<T>(name);

export const emptyTransactionMeta = TransactionMetaStore.empty();

/** A `Storage` kept in memory, which can be made to refuse some operations the way a blocked or full one does. */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  /** Operations that throw, whatever the key. */
  readonly failing = new Set<'getItem' | 'setItem' | 'removeItem'>();

  get length(): number {
    return this.items.size;
  }

  private check(operation: 'getItem' | 'setItem' | 'removeItem'): void {
    if (this.failing.has(operation)) {
      throw new DOMException('The operation is not allowed.', 'SecurityError');
    }
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    this.check('getItem');
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.check('removeItem');
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.check('setItem');
    this.items.set(key, value);
  }

  /** Every key and value, to see what was written and where (without going through the failing operations). */
  dump(): Record<string, string> {
    return Object.fromEntries(this.items);
  }
}

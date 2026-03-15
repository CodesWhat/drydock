export class RingBuffer<T> {
  private readonly capacity: number;
  private readonly entries: T[];
  private writeIndex = 0;
  private size = 0;

  constructor(capacity: number) {
    const normalizedCapacity = Number.isFinite(capacity) ? Math.trunc(capacity) : 0;
    this.capacity = normalizedCapacity > 0 ? normalizedCapacity : 1;
    this.entries = new Array<T>(this.capacity);
  }

  push(value: T): void {
    this.entries[this.writeIndex] = value;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size += 1;
    }
  }

  getLatest(): T | undefined {
    if (this.size === 0) {
      return undefined;
    }
    const latestIndex = (this.writeIndex - 1 + this.capacity) % this.capacity;
    return this.entries[latestIndex];
  }

  toArray(): T[] {
    if (this.size === 0) {
      return [];
    }
    if (this.size < this.capacity) {
      return this.entries.slice(0, this.size);
    }
    return [...this.entries.slice(this.writeIndex), ...this.entries.slice(0, this.writeIndex)];
  }
}

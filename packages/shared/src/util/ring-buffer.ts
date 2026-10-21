export class RingBuffer<T> {
  private items: T[] = [];
  private weight = 0;

  constructor(
    private readonly maxItems: number,
    private readonly maxWeight = Number.POSITIVE_INFINITY,
    private readonly weigh: (item: T) => number = () => 1,
  ) {}

  push(item: T): void {
    this.items.push(item);
    this.weight += this.weigh(item);
    this.trim();
  }

  toArray(): T[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.weight = 0;
  }

  private trim(): void {
    while (this.items.length > this.maxItems || this.weight > this.maxWeight) {
      const removed = this.items.shift();
      if (removed === undefined) break;
      this.weight -= this.weigh(removed);
    }
  }
}

/**
 * KV Store - Phase 6 Task 1
 * 
 * Provides a key-value store for the memory layer.
 * This is a simple KV store implementation (vector DB deferred).
 */

export interface KVStoreOptions {
  maxSize?: number;
  defaultTTL?: number;
  persistToDisk?: boolean;
}

export interface KVEntry {
  key: string;
  value: any;
  timestamp: Date;
  ttl?: number;
}

export class KVStore {
  private store: Map<string, KVEntry> = new Map();
  private options: KVStoreOptions;

  constructor(options?: KVStoreOptions) {
    this.options = {
      maxSize: 10000,
      defaultTTL: 3600000, // 1 hour
      persistToDisk: false,
      ...options,
    };
  }

  /**
   * Set a value in the KV store
   */
  set(key: string, value: any, ttl?: number): void {
    const entry: KVEntry = {
      key,
      value,
      timestamp: new Date(),
      ttl: ttl || this.options.defaultTTL,
    };

    this.store.set(key, entry);

    // Prune if over max size
    if (this.store.size > (this.options.maxSize || 10000)) {
      this.prune();
    }
  }

  /**
   * Get a value from the KV store
   */
  get(key: string): any | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Check if a key exists in the KV store
   */
  has(key: string): boolean {
    const entry = this.store.get(key);

    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the KV store
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Clear all entries from the KV store
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get the size of the KV store
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Get all keys in the KV store
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Get all values in the KV store
   */
  values(): any[] {
    const values: any[] = [];

    for (const entry of this.store.values()) {
      if (!this.isExpired(entry)) {
        values.push(entry.value);
      }
    }

    return values;
  }

  /**
   * Get all entries in the KV store
   */
  entries(): KVEntry[] {
    const entries: KVEntry[] = [];

    for (const entry of this.store.values()) {
      if (!this.isExpired(entry)) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Prune expired entries and enforce max size
   */
  prune(): void {
    const now = Date.now();

    // Remove expired entries
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
      }
    }

    // If still over max size, remove oldest entries
    if (this.store.size > (this.options.maxSize || 10000)) {
      const entries = Array.from(this.store.entries());
      entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());

      const toRemove = entries.slice(0, this.store.size - (this.options.maxSize || 10000));
      for (const [key] of toRemove) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Check if an entry has expired
   */
  private isExpired(entry: KVEntry): boolean {
    if (!entry.ttl) {
      return false;
    }

    const now = Date.now();
    const expiryTime = entry.timestamp.getTime() + entry.ttl;

    return now > expiryTime;
  }

  /**
   * Set multiple values at once
   */
  setMany(entries: Array<{ key: string; value: any; ttl?: number }>): void {
    for (const entry of entries) {
      this.set(entry.key, entry.value, entry.ttl);
    }
  }

  /**
   * Get multiple values at once
   */
  getMany(keys: string[]): Map<string, any> {
    const result = new Map<string, any>();

    for (const key of keys) {
      const value = this.get(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }

    return result;
  }

  /**
   * Delete multiple keys at once
   */
  deleteMany(keys: string[]): number {
    let count = 0;

    for (const key of keys) {
      if (this.delete(key)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Get KV store options
   */
  getOptions(): KVStoreOptions {
    return { ...this.options };
  }

  /**
   * Update KV store options
   */
  updateOptions(options: Partial<KVStoreOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalEntries: number;
    expiredEntries: number;
    validEntries: number;
    sizeInBytes: number;
  } {
    const entries = Array.from(this.store.values());
    let expiredCount = 0;
    let validCount = 0;
    let sizeInBytes = 0;

    for (const entry of entries) {
      const entrySize = JSON.stringify(entry.value).length;
      sizeInBytes += entrySize;

      if (this.isExpired(entry)) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      totalEntries: entries.length,
      expiredEntries: expiredCount,
      validEntries: validCount,
      sizeInBytes,
    };
  }
}

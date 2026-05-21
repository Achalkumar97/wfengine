/**
 * Context Manager - Phase 1 Task 2
 * 
 * Provides context management for agent conversations and tool execution.
 * This is the foundation for the memory/context layer.
 */

export interface ContextEntry {
  key: string;
  value: any;
  timestamp: Date;
  ttl?: number; // Time to live in milliseconds
}

export interface ContextSnapshot {
  entries: ContextEntry[];
  timestamp: Date;
  size: number;
}

export class ContextManager {
  private context: Map<string, ContextEntry> = new Map();
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize: number = 1000, defaultTTL: number = 3600000) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  /**
   * Set a context entry
   */
  set(key: string, value: any, ttl?: number): void {
    const entry: ContextEntry = {
      key,
      value,
      timestamp: new Date(),
      ttl: ttl || this.defaultTTL,
    };

    this.context.set(key, entry);
    
    // Prune if over max size
    if (this.context.size > this.maxSize) {
      this.prune();
    }
  }

  /**
   * Get a context entry
   */
  get(key: string): any | undefined {
    const entry = this.context.get(key);
    
    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.context.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Check if a context entry exists
   */
  has(key: string): boolean {
    const entry = this.context.get(key);
    
    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      this.context.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a context entry
   */
  delete(key: string): boolean {
    return this.context.delete(key);
  }

  /**
   * Clear all context entries
   */
  clear(): void {
    this.context.clear();
  }

  /**
   * Get the size of the context
   */
  size(): number {
    return this.context.size;
  }

  /**
   * Create a snapshot of the current context
   */
  snapshot(): ContextSnapshot {
    const entries = Array.from(this.context.values());
    
    return {
      entries,
      timestamp: new Date(),
      size: entries.length,
    };
  }

  /**
   * Restore context from a snapshot
   */
  restore(snapshot: ContextSnapshot): void {
    this.context.clear();
    
    for (const entry of snapshot.entries) {
      if (!this.isExpired(entry)) {
        this.context.set(entry.key, entry);
      }
    }
  }

  /**
   * Prune expired entries and enforce max size
   */
  prune(): void {
    const now = Date.now();
    
    // Remove expired entries
    for (const [key, entry] of this.context.entries()) {
      if (this.isExpired(entry)) {
        this.context.delete(key);
      }
    }

    // If still over max size, remove oldest entries
    if (this.context.size > this.maxSize) {
      const entries = Array.from(this.context.entries());
      entries.sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
      
      const toRemove = entries.slice(0, this.context.size - this.maxSize);
      for (const [key] of toRemove) {
        this.context.delete(key);
      }
    }
  }

  /**
   * Check if an entry has expired
   */
  private isExpired(entry: ContextEntry): boolean {
    if (!entry.ttl) {
      return false;
    }
    
    const now = Date.now();
    const expiryTime = entry.timestamp.getTime() + entry.ttl;
    
    return now > expiryTime;
  }

  /**
   * Get all keys in the context
   */
  keys(): string[] {
    return Array.from(this.context.keys());
  }

  /**
   * Get all values in the context
   */
  values(): any[] {
    const values: any[] = [];
    
    for (const entry of this.context.values()) {
      if (!this.isExpired(entry)) {
        values.push(entry.value);
      }
    }
    
    return values;
  }

  /**
   * Get all entries in the context
   */
  entries(): ContextEntry[] {
    const entries: ContextEntry[] = [];
    
    for (const entry of this.context.values()) {
      if (!this.isExpired(entry)) {
        entries.push(entry);
      }
    }
    
    return entries;
  }
}

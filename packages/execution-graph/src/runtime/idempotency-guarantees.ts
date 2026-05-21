/**
 * Idempotency Guarantees - Phase 7 Task 4
 * 
 * Provides idempotency guarantees for execution graph operations.
 * This ensures that repeated operations produce the same result.
 */

import type { GraphMutation } from './graph-mutation-semantics.js';

export interface IdempotencyKey {
  operation: string;
  parameters: any;
  timestamp: Date;
}

export interface IdempotencyRecord {
  key: IdempotencyKey;
  result: any;
  timestamp: Date;
  ttl: number;
}

export class IdempotencyGuarantees {
  private records: Map<string, IdempotencyRecord> = new Map();
  private defaultTTL: number = 3600000; // 1 hour

  /**
   * Generate an idempotency key from operation and parameters
   */
  generateKey(operation: string, parameters: any): string {
    const keyData = {
      operation,
      parameters,
    };
    return JSON.stringify(keyData);
  }

  /**
   * Check if an operation has already been executed
   */
  hasExecuted(operation: string, parameters: any): boolean {
    const key = this.generateKey(operation, parameters);
    const record = this.records.get(key);

    if (!record) {
      return false;
    }

    // Check if record has expired
    if (this.isExpired(record)) {
      this.records.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get the result of a previously executed operation
   */
  getResult(operation: string, parameters: any): any | undefined {
    const key = this.generateKey(operation, parameters);
    const record = this.records.get(key);

    if (!record) {
      return undefined;
    }

    if (this.isExpired(record)) {
      this.records.delete(key);
      return undefined;
    }

    return record.result;
  }

  /**
   * Record the result of an operation
   */
  recordResult(operation: string, parameters: any, result: any, ttl?: number): void {
    const key = this.generateKey(operation, parameters);
    const record: IdempotencyRecord = {
      key: {
        operation,
        parameters,
        timestamp: new Date(),
      },
      result,
      timestamp: new Date(),
      ttl: ttl || this.defaultTTL,
    };

    this.records.set(key, record);
  }

  /**
   * Check if a record has expired
   */
  private isExpired(record: IdempotencyRecord): boolean {
    const now = Date.now();
    const expiryTime = record.timestamp.getTime() + record.ttl;
    return now > expiryTime;
  }

  /**
   * Clear expired records
   */
  clearExpired(): number {
    let count = 0;

    for (const [key, record] of this.records.entries()) {
      if (this.isExpired(record)) {
        this.records.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Clear all records
   */
  clearAll(): void {
    this.records.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRecords: number;
    expiredRecords: number;
    validRecords: number;
  } {
    let expiredCount = 0;
    let validCount = 0;

    for (const record of this.records.values()) {
      if (this.isExpired(record)) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      totalRecords: this.records.size,
      expiredRecords: expiredCount,
      validRecords: validCount,
    };
  }

  /**
   * Validate idempotency for a mutation
   */
  validateMutationIdempotency(mutation: GraphMutation): boolean {
    const key = this.generateKey(mutation.type, mutation.data);
    return !this.records.has(key);
  }

  /**
   * Execute an operation with idempotency guarantees
   */
  async executeWithIdempotency(
    operation: string,
    parameters: any,
    fn: () => Promise<any>,
    ttl?: number
  ): Promise<any> {
    // Check if operation has already been executed
    if (this.hasExecuted(operation, parameters)) {
      return this.getResult(operation, parameters);
    }

    // Execute the operation
    const result = await fn();

    // Record the result
    this.recordResult(operation, parameters, result, ttl);

    return result;
  }

  /**
   * Set default TTL
   */
  setDefaultTTL(ttl: number): void {
    this.defaultTTL = ttl;
  }

  /**
   * Get default TTL
   */
  getDefaultTTL(): number {
    return this.defaultTTL;
  }
}

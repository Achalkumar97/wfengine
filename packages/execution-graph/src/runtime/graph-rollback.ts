/**
 * Graph Rollback - Phase 7 Task 2
 * 
 * Provides rollback functionality for execution graphs.
 * This enables reverting graph mutations to a previous state.
 */

import type { GraphSnapshot, GraphMutation } from './graph-mutation-semantics.js';

export interface RollbackPoint {
  snapshot: GraphSnapshot;
  mutationIndex: number;
  timestamp: Date;
  reason: string;
}

export class GraphRollback {
  private rollbackPoints: Map<string, RollbackPoint> = new Map();
  private currentMutationIndex: number = 0;

  /**
   * Create a rollback point
   */
  createRollbackPoint(
    id: string,
    snapshot: GraphSnapshot,
    reason: string = 'Manual checkpoint'
  ): RollbackPoint {
    const rollbackPoint: RollbackPoint = {
      snapshot,
      mutationIndex: this.currentMutationIndex,
      timestamp: new Date(),
      reason,
    };

    this.rollbackPoints.set(id, rollbackPoint);
    return rollbackPoint;
  }

  /**
   * Rollback to a specific rollback point
   */
  rollbackTo(id: string): GraphSnapshot | null {
    const rollbackPoint = this.rollbackPoints.get(id);
    if (!rollbackPoint) {
      return null;
    }

    this.currentMutationIndex = rollbackPoint.mutationIndex;
    return rollbackPoint.snapshot;
  }

  /**
   * Rollback to a specific mutation index
   */
  rollbackToMutationIndex(index: number, snapshot: GraphSnapshot): GraphSnapshot {
    this.currentMutationIndex = index;
    return snapshot;
  }

  /**
   * Rollback by a number of mutations
   */
  rollbackBy(count: number, snapshot: GraphSnapshot): GraphSnapshot {
    const targetIndex = Math.max(0, this.currentMutationIndex - count);
    this.currentMutationIndex = targetIndex;
    return snapshot;
  }

  /**
   * Get a rollback point
   */
  getRollbackPoint(id: string): RollbackPoint | undefined {
    return this.rollbackPoints.get(id);
  }

  /**
   * Get all rollback points
   */
  getAllRollbackPoints(): RollbackPoint[] {
    return Array.from(this.rollbackPoints.values()).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
  }

  /**
   * Delete a rollback point
   */
  deleteRollbackPoint(id: string): boolean {
    return this.rollbackPoints.delete(id);
  }

  /**
   * Clear all rollback points
   */
  clearRollbackPoints(): void {
    this.rollbackPoints.clear();
  }

  /**
   * Get the current mutation index
   */
  getCurrentMutationIndex(): number {
    return this.currentMutationIndex;
  }

  /**
   * Set the current mutation index
   */
  setCurrentMutationIndex(index: number): void {
    this.currentMutationIndex = index;
  }

  /**
   * Get rollback statistics
   */
  getStats(): {
    totalRollbackPoints: number;
    currentMutationIndex: number;
    oldestRollbackPoint: Date | null;
    newestRollbackPoint: Date | null;
  } {
    const points = this.getAllRollbackPoints();

    return {
      totalRollbackPoints: points.length,
      currentMutationIndex: this.currentMutationIndex,
      oldestRollbackPoint: points.length > 0 ? points[0].timestamp : null,
      newestRollbackPoint: points.length > 0 ? points[points.length - 1].timestamp : null,
    };
  }

  /**
   * Check if a rollback is possible
   */
  canRollbackTo(id: string): boolean {
    return this.rollbackPoints.has(id);
  }

  /**
   * Check if rollback by count is possible
   */
  canRollbackBy(count: number): boolean {
    return this.currentMutationIndex >= count;
  }

  /**
   * Auto-create rollback point before mutation
   */
  autoCreateBeforeMutation(
    id: string,
    snapshot: GraphSnapshot,
    mutation: GraphMutation
  ): void {
    this.createRollbackPoint(
      `auto-${mutation.type}-${Date.now()}`,
      snapshot,
      `Auto-created before ${mutation.type}`
    );
  }
}

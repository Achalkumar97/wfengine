/**
 * Checkpoint System - Phase 2 Task 2
 * 
 * Provides checkpoint storage for workflow state machine.
 * This enables recovery from failures and supports state persistence.
 */

import type { WorkflowStateMachine } from './state-machine.js';

export interface Checkpoint {
  id: string;
  workflowId: string;
  stateMachineSnapshot: any;
  context: any;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface CheckpointOptions {
  autoCheckpoint?: boolean;
  checkpointInterval?: number;
  maxCheckpoints?: number;
}

export class CheckpointSystem {
  private checkpoints: Map<string, Checkpoint> = new Map();
  private options: CheckpointOptions;
  private checkpointTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options?: CheckpointOptions) {
    this.options = {
      autoCheckpoint: false,
      checkpointInterval: 30000, // 30 seconds
      maxCheckpoints: 10,
      ...options,
    };
  }

  /**
   * Create a checkpoint for a workflow
   */
  async createCheckpoint(
    workflowId: string,
    stateMachine: WorkflowStateMachine,
    context: any,
    metadata?: Record<string, any>
  ): Promise<string> {
    const checkpointId = `${workflowId}-${Date.now()}`;
    
    const checkpoint: Checkpoint = {
      id: checkpointId,
      workflowId,
      stateMachineSnapshot: stateMachine.snapshot(),
      context,
      timestamp: new Date(),
      metadata,
    };

    this.checkpoints.set(checkpointId, checkpoint);
    
    // Prune old checkpoints if over max
    this.pruneCheckpoints(workflowId);

    return checkpointId;
  }

  /**
   * Restore a workflow from a checkpoint
   */
  async restoreCheckpoint(
    checkpointId: string,
    stateMachine: WorkflowStateMachine
  ): Promise<{ context: any; metadata?: Record<string, any> } | null> {
    const checkpoint = this.checkpoints.get(checkpointId);
    
    if (!checkpoint) {
      return null;
    }

    // Restore state machine state
    stateMachine.restore(checkpoint.stateMachineSnapshot);

    return {
      context: checkpoint.context,
      metadata: checkpoint.metadata,
    };
  }

  /**
   * Get the latest checkpoint for a workflow
   */
  getLatestCheckpoint(workflowId: string): Checkpoint | null {
    const workflowCheckpoints = Array.from(this.checkpoints.values())
      .filter(cp => cp.workflowId === workflowId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return workflowCheckpoints[0] || null;
  }

  /**
   * Get all checkpoints for a workflow
   */
  getWorkflowCheckpoints(workflowId: string): Checkpoint[] {
    return Array.from(this.checkpoints.values())
      .filter(cp => cp.workflowId === workflowId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(checkpointId: string): boolean {
    return this.checkpoints.delete(checkpointId);
  }

  /**
   * Delete all checkpoints for a workflow
   */
  deleteWorkflowCheckpoints(workflowId: string): number {
    let count = 0;
    
    for (const [id, checkpoint] of this.checkpoints.entries()) {
      if (checkpoint.workflowId === workflowId) {
        this.checkpoints.delete(id);
        count++;
      }
    }

    return count;
  }

  /**
   * Prune old checkpoints for a workflow
   */
  private pruneCheckpoints(workflowId: string): void {
    const workflowCheckpoints = this.getWorkflowCheckpoints(workflowId);
    
    if (workflowCheckpoints.length > (this.options.maxCheckpoints || 10)) {
      const toRemove = workflowCheckpoints.slice(this.options.maxCheckpoints || 10);
      
      for (const checkpoint of toRemove) {
        this.checkpoints.delete(checkpoint.id);
      }
    }
  }

  /**
   * Enable auto-checkpointing for a workflow
   */
  enableAutoCheckpoint(
    workflowId: string,
    stateMachine: WorkflowStateMachine,
    context: any,
    interval?: number
  ): void {
    const checkpointInterval = interval || this.options.checkpointInterval;
    
    // Clear existing timer if any
    this.disableAutoCheckpoint(workflowId);
    
    const timer = setInterval(async () => {
      await this.createCheckpoint(workflowId, stateMachine, context);
    }, checkpointInterval);
    
    this.checkpointTimers.set(workflowId, timer);
  }

  /**
   * Disable auto-checkpointing for a workflow
   */
  disableAutoCheckpoint(workflowId: string): void {
    const timer = this.checkpointTimers.get(workflowId);
    
    if (timer) {
      clearInterval(timer);
      this.checkpointTimers.delete(workflowId);
    }
  }

  /**
   * Get checkpoint system options
   */
  getOptions(): CheckpointOptions {
    return { ...this.options };
  }

  /**
   * Update checkpoint system options
   */
  updateOptions(options: Partial<CheckpointOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Clear all checkpoints
   */
  clearAll(): void {
    this.checkpoints.clear();
    
    // Clear all timers
    for (const timer of this.checkpointTimers.values()) {
      clearInterval(timer);
    }
    
    this.checkpointTimers.clear();
  }

  /**
   * Get checkpoint statistics
   */
  getStats(): {
    totalCheckpoints: number;
    workflowsWithCheckpoints: number;
    autoCheckpointingWorkflows: number;
  } {
    const workflowIds = new Set(
      Array.from(this.checkpoints.values()).map(cp => cp.workflowId)
    );

    return {
      totalCheckpoints: this.checkpoints.size,
      workflowsWithCheckpoints: workflowIds.size,
      autoCheckpointingWorkflows: this.checkpointTimers.size,
    };
  }
}

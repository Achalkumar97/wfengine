/**
 * Shared Semantics - Phase 3 Task 1
 * 
 * Defines shared semantics that all orchestration strategies must obey.
 * This ensures consistency across different orchestration strategies.
 */

import { WorkflowState } from '../state-machine/state-machine.js';

export interface WorkflowEvent {
  type: 'state_change' | 'retry' | 'delegation' | 'cancellation' | 'completion' | 'error';
  timestamp: Date;
  data: any;
}

export interface RetrySemantics {
  maxRetries: number;
  retryDelay: number;
  retryBackoff: number;
  retryableErrors: string[];
}

export interface DelegationSemantics {
  ownershipModel: 'exclusive' | 'shared';
  cancellationPropagation: boolean;
  taskPriority: 'high' | 'medium' | 'low';
  conflictResolution: 'first-come' | 'priority' | 'random';
  retryAuthority: 'delegator' | 'delegate';
  agentStarvationHandling: 'timeout' | 'priority' | 'none';
  recursionLimit: number;
  deadlockPrevention: boolean;
}

export interface CancellationSemantics {
  propagateToChildren: boolean;
  propagateToDelegates: boolean;
  forceTerminate: boolean;
  gracePeriod: number;
}

export interface SharedSemantics {
  workflowState: WorkflowState;
  events: WorkflowEvent[];
  retry: RetrySemantics;
  delegation: DelegationSemantics;
  cancellation: CancellationSemantics;
}

export class SharedSemanticsManager {
  private semantics: Map<string, SharedSemantics> = new Map();

  /**
   * Get shared semantics for a workflow
   */
  getSemantics(workflowId: string): SharedSemantics | undefined {
    return this.semantics.get(workflowId);
  }

  /**
   * Set shared semantics for a workflow
   */
  setSemantics(workflowId: string, semantics: SharedSemantics): void {
    this.semantics.set(workflowId, semantics);
  }

  /**
   * Create default shared semantics
   */
  createDefaultSemantics(initialState: WorkflowState = WorkflowState.PENDING): SharedSemantics {
    return {
      workflowState: initialState,
      events: [],
      retry: {
        maxRetries: 3,
        retryDelay: 1000,
        retryBackoff: 2,
        retryableErrors: ['timeout', 'rate_limit', 'temporary_failure'],
      },
      delegation: {
        ownershipModel: 'exclusive',
        cancellationPropagation: true,
        taskPriority: 'medium',
        conflictResolution: 'priority',
        retryAuthority: 'delegator',
        agentStarvationHandling: 'timeout',
        recursionLimit: 10,
        deadlockPrevention: true,
      },
      cancellation: {
        propagateToChildren: true,
        propagateToDelegates: true,
        forceTerminate: false,
        gracePeriod: 5000,
      },
    };
  }

  /**
   * Add an event to the shared semantics
   */
  addEvent(workflowId: string, event: WorkflowEvent): void {
    const semantics = this.semantics.get(workflowId);
    if (semantics) {
      semantics.events.push(event);
    }
  }

  /**
   * Update workflow state in shared semantics
   */
  updateWorkflowState(workflowId: string, state: WorkflowState): void {
    const semantics = this.semantics.get(workflowId);
    if (semantics) {
      semantics.workflowState = state;
    }
  }

  /**
   * Update retry semantics
   */
  updateRetrySemantics(workflowId: string, retry: Partial<RetrySemantics>): void {
    const semantics = this.semantics.get(workflowId);
    if (semantics) {
      semantics.retry = { ...semantics.retry, ...retry };
    }
  }

  /**
   * Update delegation semantics
   */
  updateDelegationSemantics(workflowId: string, delegation: Partial<DelegationSemantics>): void {
    const semantics = this.semantics.get(workflowId);
    if (semantics) {
      semantics.delegation = { ...semantics.delegation, ...delegation };
    }
  }

  /**
   * Update cancellation semantics
   */
  updateCancellationSemantics(workflowId: string, cancellation: Partial<CancellationSemantics>): void {
    const semantics = this.semantics.get(workflowId);
    if (semantics) {
      semantics.cancellation = { ...semantics.cancellation, ...cancellation };
    }
  }

  /**
   * Remove shared semantics for a workflow
   */
  removeSemantics(workflowId: string): boolean {
    return this.semantics.delete(workflowId);
  }

  /**
   * Clear all shared semantics
   */
  clearAll(): void {
    this.semantics.clear();
  }

  /**
   * Get all workflow IDs with shared semantics
   */
  getWorkflowIds(): string[] {
    return Array.from(this.semantics.keys());
  }
}

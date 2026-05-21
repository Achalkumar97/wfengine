/**
 * State Machine - Phase 2 Task 1
 * 
 * Implements workflow state machine with 6 states: PENDING, EXECUTING, RETRYING, PAUSED, FAILED, COMPLETED
 * This provides the foundation for orchestration and workflow management.
 */

export enum WorkflowState {
  PENDING = 'PENDING',
  EXECUTING = 'EXECUTING',
  RETRYING = 'RETRYING',
  PAUSED = 'PAUSED',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
}

export interface StateTransition {
  from: WorkflowState;
  to: WorkflowState;
  reason: string;
  timestamp: Date;
}

export interface WorkflowStateMachineConfig {
  maxRetries?: number;
  retryDelay?: number;
  allowManualPause?: boolean;
}

export class WorkflowStateMachine {
  private currentState: WorkflowState;
  private transitions: StateTransition[] = [];
  private config: WorkflowStateMachineConfig;
  private retryCount: number = 0;

  constructor(initialState: WorkflowState = WorkflowState.PENDING, config?: WorkflowStateMachineConfig) {
    this.currentState = initialState;
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      allowManualPause: true,
      ...config,
    };
    
    this.recordTransition(initialState, 'Initial state');
  }

  /**
   * Get current state
   */
  getCurrentState(): WorkflowState {
    return this.currentState;
  }

  /**
   * Transition to a new state
   */
  transition(to: WorkflowState, reason: string): boolean {
    if (!this.isValidTransition(this.currentState, to)) {
      return false;
    }

    const previousState = this.currentState;
    this.currentState = to;
    
    // Reset retry count when transitioning to EXECUTING from RETRYING
    if (to === WorkflowState.EXECUTING && previousState === WorkflowState.RETRYING) {
      this.retryCount = 0;
    }
    
    // Increment retry count when transitioning to RETRYING
    if (to === WorkflowState.RETRYING) {
      this.retryCount++;
    }

    this.recordTransition(to, reason);
    return true;
  }

  /**
   * Check if a transition is valid
   */
  private isValidTransition(from: WorkflowState, to: WorkflowState): boolean {
    const validTransitions: Record<WorkflowState, WorkflowState[]> = {
      [WorkflowState.PENDING]: [WorkflowState.EXECUTING, WorkflowState.FAILED],
      [WorkflowState.EXECUTING]: [WorkflowState.RETRYING, WorkflowState.PAUSED, WorkflowState.FAILED, WorkflowState.COMPLETED],
      [WorkflowState.RETRYING]: [WorkflowState.EXECUTING, WorkflowState.FAILED],
      [WorkflowState.PAUSED]: [WorkflowState.EXECUTING, WorkflowState.FAILED],
      [WorkflowState.FAILED]: [], // Terminal state
      [WorkflowState.COMPLETED]: [], // Terminal state
    };

    return validTransitions[from].includes(to);
  }

  /**
   * Record a state transition
   */
  private recordTransition(to: WorkflowState, reason: string): void {
    this.transitions.push({
      from: this.currentState,
      to,
      reason,
      timestamp: new Date(),
    });
  }

  /**
   * Get all transitions
   */
  getTransitions(): StateTransition[] {
    return [...this.transitions];
  }

  /**
   * Get retry count
   */
  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Check if max retries exceeded
   */
  isMaxRetriesExceeded(): boolean {
    return this.retryCount >= (this.config.maxRetries || 3);
  }

  /**
   * Check if state is terminal
   */
  isTerminalState(state: WorkflowState): boolean {
    return state === WorkflowState.FAILED || state === WorkflowState.COMPLETED;
  }

  /**
   * Check if current state is terminal
   */
  isTerminal(): boolean {
    return this.isTerminalState(this.currentState);
  }

  /**
   * Check if can retry
   */
  canRetry(): boolean {
    return this.currentState === WorkflowState.RETRYING && !this.isMaxRetriesExceeded();
  }

  /**
   * Check if can pause
   */
  canPause(): boolean {
    return (this.config.allowManualPause ?? true) && this.currentState === WorkflowState.EXECUTING;
  }

  /**
   * Check if can resume
   */
  canResume(): boolean {
    return this.currentState === WorkflowState.PAUSED;
  }

  /**
   * Reset state machine to initial state
   */
  reset(): void {
    this.currentState = WorkflowState.PENDING;
    this.transitions = [];
    this.retryCount = 0;
    this.recordTransition(WorkflowState.PENDING, 'Reset');
  }

  /**
   * Get state machine configuration
   */
  getConfig(): WorkflowStateMachineConfig {
    return { ...this.config };
  }

  /**
   * Update state machine configuration
   */
  updateConfig(config: Partial<WorkflowStateMachineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Create a snapshot of the current state
   */
  snapshot(): {
    state: WorkflowState;
    retryCount: number;
    transitions: StateTransition[];
    config: WorkflowStateMachineConfig;
  } {
    return {
      state: this.currentState,
      retryCount: this.retryCount,
      transitions: [...this.transitions],
      config: { ...this.config },
    };
  }

  /**
   * Restore state from a snapshot
   */
  restore(snapshot: {
    state: WorkflowState;
    retryCount: number;
    transitions: StateTransition[];
    config: WorkflowStateMachineConfig;
  }): void {
    this.currentState = snapshot.state;
    this.retryCount = snapshot.retryCount;
    this.transitions = snapshot.transitions;
    this.config = snapshot.config;
  }
}

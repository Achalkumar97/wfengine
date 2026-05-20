/**
 * Orchestration Kernel - Phase 3 Task 3
 * 
 * Implements the orchestration kernel as the central coordination layer.
 * This provides shared semantics and execution contracts for all orchestration strategies.
 */

import { WorkflowStateMachine, WorkflowState } from '../state-machine/state-machine.js';
import { SharedSemanticsManager } from './shared-semantics.js';
import { ExecutionContracts } from './execution-contracts.js';
import type { SharedSemantics } from './shared-semantics.js';
import type { DelegationContract, TaskContract, AgentContract } from './execution-contracts.js';

export interface OrchestrationKernelConfig {
  enableSharedSemantics?: boolean;
  enableExecutionContracts?: boolean;
  defaultMaxRetries?: number;
  defaultRetryDelay?: number;
}

export class OrchestrationKernel {
  private sharedSemanticsManager: SharedSemanticsManager;
  private config: OrchestrationKernelConfig;
  private stateMachines: Map<string, WorkflowStateMachine> = new Map();
  private delegationContracts: Map<string, DelegationContract> = new Map();
  private taskContracts: Map<string, TaskContract> = new Map();
  private agentContracts: Map<string, AgentContract> = new Map();

  constructor(config?: OrchestrationKernelConfig) {
    this.config = {
      enableSharedSemantics: true,
      enableExecutionContracts: true,
      defaultMaxRetries: 3,
      defaultRetryDelay: 1000,
      ...config,
    };
    
    this.sharedSemanticsManager = new SharedSemanticsManager();
  }

  /**
   * Initialize orchestration for a workflow
   */
  initializeWorkflow(workflowId: string, initialState: WorkflowState = WorkflowState.PENDING): void {
    // Create state machine
    const stateMachine = new WorkflowStateMachine(initialState, {
      maxRetries: this.config.defaultMaxRetries,
      retryDelay: this.config.defaultRetryDelay,
    });
    this.stateMachines.set(workflowId, stateMachine);

    // Initialize shared semantics
    if (this.config.enableSharedSemantics) {
      const semantics = this.sharedSemanticsManager.createDefaultSemantics(initialState);
      this.sharedSemanticsManager.setSemantics(workflowId, semantics);
    }
  }

  /**
   * Get state machine for a workflow
   */
  getStateMachine(workflowId: string): WorkflowStateMachine | undefined {
    return this.stateMachines.get(workflowId);
  }

  /**
   * Get shared semantics for a workflow
   */
  getSharedSemantics(workflowId: string): SharedSemantics | undefined {
    return this.sharedSemanticsManager.getSemantics(workflowId);
  }

  /**
   * Transition workflow state
   */
  transitionState(workflowId: string, to: WorkflowState, reason: string): boolean {
    const stateMachine = this.stateMachines.get(workflowId);
    if (!stateMachine) {
      return false;
    }

    const success = stateMachine.transition(to, reason);
    
    if (success && this.config.enableSharedSemantics) {
      this.sharedSemanticsManager.updateWorkflowState(workflowId, to);
      this.sharedSemanticsManager.addEvent(workflowId, {
        type: 'state_change',
        timestamp: new Date(),
        data: { from: stateMachine.getCurrentState(), to, reason },
      });
    }

    return success;
  }

  /**
   * Create a delegation contract
   */
  createDelegationContract(params: {
    delegatorId: string;
    delegateId: string;
    taskId: string;
    permissions: string[];
    constraints?: Record<string, any>;
    timeout?: number;
    expiresAt?: Date;
  }): DelegationContract {
    if (!this.config.enableExecutionContracts) {
      throw new Error('Execution contracts are disabled');
    }

    const contract = ExecutionContracts.createDelegationContract(params);
    const validation = ExecutionContracts.validateDelegationContract(contract);
    
    if (!validation.valid) {
      throw new Error(`Invalid delegation contract: ${validation.errors.join(', ')}`);
    }

    this.delegationContracts.set(contract.delegationId, contract);
    
    if (this.config.enableSharedSemantics) {
      const semantics = this.sharedSemanticsManager.getSemantics(params.taskId);
      if (semantics) {
        this.sharedSemanticsManager.addEvent(params.taskId, {
          type: 'delegation',
          timestamp: new Date(),
          data: { delegationId: contract.delegationId },
        });
      }
    }

    return contract;
  }

  /**
   * Get a delegation contract
   */
  getDelegationContract(delegationId: string): DelegationContract | undefined {
    return this.delegationContracts.get(delegationId);
  }

  /**
   * Create a task contract
   */
  createTaskContract(params: {
    taskId: string;
    workflowId: string;
    agentId: string;
    taskType: string;
    input: any;
    priority?: 'high' | 'medium' | 'low';
    metadata?: Record<string, any>;
  }): TaskContract {
    if (!this.config.enableExecutionContracts) {
      throw new Error('Execution contracts are disabled');
    }

    const contract = ExecutionContracts.createTaskContract(params);
    const validation = ExecutionContracts.validateTaskContract(contract);
    
    if (!validation.valid) {
      throw new Error(`Invalid task contract: ${validation.errors.join(', ')}`);
    }

    this.taskContracts.set(contract.taskId, contract);
    
    if (this.config.enableSharedSemantics) {
      const semantics = this.sharedSemanticsManager.getSemantics(params.workflowId);
      if (semantics) {
        this.sharedSemanticsManager.addEvent(params.workflowId, {
          type: 'completion',
          timestamp: new Date(),
          data: { taskId: contract.taskId },
        });
      }
    }

    return contract;
  }

  /**
   * Get a task contract
   */
  getTaskContract(taskId: string): TaskContract | undefined {
    return this.taskContracts.get(taskId);
  }

  /**
   * Create an agent contract
   */
  createAgentContract(params: {
    agentId: string;
    agentType: string;
    capabilities: string[];
    constraints?: Record<string, any>;
    maxConcurrentTasks?: number;
  }): AgentContract {
    if (!this.config.enableExecutionContracts) {
      throw new Error('Execution contracts are disabled');
    }

    const contract = ExecutionContracts.createAgentContract(params);
    const validation = ExecutionContracts.validateAgentContract(contract);
    
    if (!validation.valid) {
      throw new Error(`Invalid agent contract: ${validation.errors.join(', ')}`);
    }

    this.agentContracts.set(contract.agentId, contract);
    return contract;
  }

  /**
   * Get an agent contract
   */
  getAgentContract(agentId: string): AgentContract | undefined {
    return this.agentContracts.get(agentId);
  }

  /**
   * Update task contract status
   */
  updateTaskContractStatus(taskId: string, status: TaskContract['status'], output?: any, error?: string): boolean {
    const contract = this.taskContracts.get(taskId);
    if (!contract) {
      return false;
    }

    contract.status = status;
    
    if (output !== undefined) {
      contract.output = output;
    }
    
    if (error !== undefined) {
      contract.error = error;
    }

    if (status === 'executing' && !contract.startedAt) {
      contract.startedAt = new Date();
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      contract.completedAt = new Date();
    }

    return true;
  }

  /**
   * Update agent contract status
   */
  updateAgentContractStatus(agentId: string, status: AgentContract['status'], currentTasks?: number): boolean {
    const contract = this.agentContracts.get(agentId);
    if (!contract) {
      return false;
    }

    contract.status = status;
    
    if (currentTasks !== undefined) {
      contract.currentTasks = currentTasks;
    }

    if (status === 'busy') {
      contract.lastHeartbeat = new Date();
    }

    return true;
  }

  /**
   * Cleanup workflow orchestration
   */
  cleanupWorkflow(workflowId: string): void {
    this.stateMachines.delete(workflowId);
    this.sharedSemanticsManager.removeSemantics(workflowId);
    
    // Cleanup related contracts
    for (const [taskId, contract] of this.taskContracts.entries()) {
      if (contract.workflowId === workflowId) {
        this.taskContracts.delete(taskId);
      }
    }
  }

  /**
   * Get kernel configuration
   */
  getConfig(): OrchestrationKernelConfig {
    return { ...this.config };
  }

  /**
   * Update kernel configuration
   */
  updateConfig(config: Partial<OrchestrationKernelConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get kernel statistics
   */
  getStats(): {
    activeWorkflows: number;
    totalStateMachines: number;
    totalDelegationContracts: number;
    totalTaskContracts: number;
    totalAgentContracts: number;
  } {
    return {
      activeWorkflows: this.stateMachines.size,
      totalStateMachines: this.stateMachines.size,
      totalDelegationContracts: this.delegationContracts.size,
      totalTaskContracts: this.taskContracts.size,
      totalAgentContracts: this.agentContracts.size,
    };
  }
}

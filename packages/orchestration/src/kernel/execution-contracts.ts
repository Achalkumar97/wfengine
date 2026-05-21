/**
 * Execution Contracts - Phase 3 Task 2
 * 
 * Defines formal execution contracts that all orchestration strategies must obey.
 * This ensures consistency and provides clear interfaces for orchestration components.
 */

export interface DelegationContract {
  delegatorId: string;
  delegateId: string;
  taskId: string;
  delegationId: string;
  permissions: string[];
  constraints: Record<string, any>;
  timeout: number;
  createdAt: Date;
  expiresAt?: Date;
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'failed' | 'cancelled';
}

export interface TaskContract {
  taskId: string;
  workflowId: string;
  agentId: string;
  taskType: string;
  input: any;
  output?: any;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  metadata?: Record<string, any>;
}

export interface AgentContract {
  agentId: string;
  agentType: string;
  capabilities: string[];
  constraints: Record<string, any>;
  maxConcurrentTasks: number;
  currentTasks: number;
  status: 'idle' | 'busy' | 'offline';
  lastHeartbeat?: Date;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
}

export class ExecutionContracts {
  /**
   * Validate a delegation contract
   */
  static validateDelegationContract(contract: DelegationContract): ContractValidationResult {
    const errors: string[] = [];

    if (!contract.delegatorId || typeof contract.delegatorId !== 'string') {
      errors.push('Delegator ID is required and must be a string');
    }

    if (!contract.delegateId || typeof contract.delegateId !== 'string') {
      errors.push('Delegate ID is required and must be a string');
    }

    if (!contract.taskId || typeof contract.taskId !== 'string') {
      errors.push('Task ID is required and must be a string');
    }

    if (!contract.delegationId || typeof contract.delegationId !== 'string') {
      errors.push('Delegation ID is required and must be a string');
    }

    if (!Array.isArray(contract.permissions)) {
      errors.push('Permissions must be an array');
    }

    if (contract.timeout <= 0) {
      errors.push('Timeout must be positive');
    }

    if (!(contract.createdAt instanceof Date)) {
      errors.push('Created at must be a Date');
    }

    if (contract.expiresAt && !(contract.expiresAt instanceof Date)) {
      errors.push('Expires at must be a Date');
    }

    if (contract.expiresAt && contract.expiresAt <= contract.createdAt) {
      errors.push('Expires at must be after created at');
    }

    const validStatuses = ['pending', 'accepted', 'rejected', 'completed', 'failed', 'cancelled'];
    if (!validStatuses.includes(contract.status)) {
      errors.push(`Invalid status: ${contract.status}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate a task contract
   */
  static validateTaskContract(contract: TaskContract): ContractValidationResult {
    const errors: string[] = [];

    if (!contract.taskId || typeof contract.taskId !== 'string') {
      errors.push('Task ID is required and must be a string');
    }

    if (!contract.workflowId || typeof contract.workflowId !== 'string') {
      errors.push('Workflow ID is required and must be a string');
    }

    if (!contract.agentId || typeof contract.agentId !== 'string') {
      errors.push('Agent ID is required and must be a string');
    }

    if (!contract.taskType || typeof contract.taskType !== 'string') {
      errors.push('Task type is required and must be a string');
    }

    if (contract.input === undefined) {
      errors.push('Input is required');
    }

    const validStatuses = ['pending', 'executing', 'completed', 'failed', 'cancelled'];
    if (!validStatuses.includes(contract.status)) {
      errors.push(`Invalid status: ${contract.status}`);
    }

    const validPriorities = ['high', 'medium', 'low'];
    if (!validPriorities.includes(contract.priority)) {
      errors.push(`Invalid priority: ${contract.priority}`);
    }

    if (!(contract.createdAt instanceof Date)) {
      errors.push('Created at must be a Date');
    }

    if (contract.startedAt && !(contract.startedAt instanceof Date)) {
      errors.push('Started at must be a Date');
    }

    if (contract.completedAt && !(contract.completedAt instanceof Date)) {
      errors.push('Completed at must be a Date');
    }

    if (contract.startedAt && contract.completedAt && contract.completedAt < contract.startedAt) {
      errors.push('Completed at must be after started at');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate an agent contract
   */
  static validateAgentContract(contract: AgentContract): ContractValidationResult {
    const errors: string[] = [];

    if (!contract.agentId || typeof contract.agentId !== 'string') {
      errors.push('Agent ID is required and must be a string');
    }

    if (!contract.agentType || typeof contract.agentType !== 'string') {
      errors.push('Agent type is required and must be a string');
    }

    if (!Array.isArray(contract.capabilities)) {
      errors.push('Capabilities must be an array');
    }

    if (contract.maxConcurrentTasks <= 0) {
      errors.push('Max concurrent tasks must be positive');
    }

    if (contract.currentTasks < 0) {
      errors.push('Current tasks cannot be negative');
    }

    if (contract.currentTasks > contract.maxConcurrentTasks) {
      errors.push('Current tasks cannot exceed max concurrent tasks');
    }

    const validStatuses = ['idle', 'busy', 'offline'];
    if (!validStatuses.includes(contract.status)) {
      errors.push(`Invalid status: ${contract.status}`);
    }

    if (contract.lastHeartbeat && !(contract.lastHeartbeat instanceof Date)) {
      errors.push('Last heartbeat must be a Date');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create a delegation contract
   */
  static createDelegationContract(params: {
    delegatorId: string;
    delegateId: string;
    taskId: string;
    permissions: string[];
    constraints?: Record<string, any>;
    timeout?: number;
    expiresAt?: Date;
  }): DelegationContract {
    return {
      delegatorId: params.delegatorId,
      delegateId: params.delegateId,
      taskId: params.taskId,
      delegationId: `delegation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      permissions: params.permissions,
      constraints: params.constraints || {},
      timeout: params.timeout || 30000,
      createdAt: new Date(),
      expiresAt: params.expiresAt,
      status: 'pending',
    };
  }

  /**
   * Create a task contract
   */
  static createTaskContract(params: {
    taskId: string;
    workflowId: string;
    agentId: string;
    taskType: string;
    input: any;
    priority?: 'high' | 'medium' | 'low';
    metadata?: Record<string, any>;
  }): TaskContract {
    return {
      taskId: params.taskId,
      workflowId: params.workflowId,
      agentId: params.agentId,
      taskType: params.taskType,
      input: params.input,
      status: 'pending',
      priority: params.priority || 'medium',
      createdAt: new Date(),
      metadata: params.metadata,
    };
  }

  /**
   * Create an agent contract
   */
  static createAgentContract(params: {
    agentId: string;
    agentType: string;
    capabilities: string[];
    constraints?: Record<string, any>;
    maxConcurrentTasks?: number;
  }): AgentContract {
    return {
      agentId: params.agentId,
      agentType: params.agentType,
      capabilities: params.capabilities,
      constraints: params.constraints || {},
      maxConcurrentTasks: params.maxConcurrentTasks || 5,
      currentTasks: 0,
      status: 'idle',
    };
  }
}

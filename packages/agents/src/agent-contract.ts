/**
 * Formal Agent Contract - Phase 4 Task 2 (NEW - CRITICAL)
 * 
 * Defines a strict runtime interface for agents to ensure consistent orchestration and evaluation.
 * All agents must implement this contract to participate in the orchestration system.
 */

export interface AgentCapabilities {
  capabilities: string[];
  constraints: Record<string, any>;
  maxConcurrentTasks: number;
}

export interface AgentPlanResult {
  plan: any;
  reasoning: string;
  estimatedSteps: number;
  estimatedDuration: number;
}

export interface AgentExecuteResult {
  result: any;
  success: boolean;
  error?: string;
  executionTime: number;
  toolCalls: number;
}

export interface AgentEvaluateResult {
  score: number;
  confidence: number;
  feedback: string;
  metrics: Record<string, number>;
}

/**
 * Formal Agent Contract Interface
 * All agents must implement this interface to participate in the orchestration system.
 */
export interface IAgent {
  /**
   * Unique identifier for the agent
   */
  id: string;

  /**
   * Agent type (e.g., 'planner', 'executor', 'evaluator', 'supervisor')
   */
  type: string;

  /**
   * Get agent capabilities
   */
  getCapabilities(): AgentCapabilities;

  /**
   * Plan execution for a given task
   * Returns a plan with reasoning and estimates
   */
  plan(task: any, context: any): Promise<AgentPlanResult>;

  /**
   * Execute a plan or task
   * Returns the execution result with metrics
   */
  execute(plan: any, context: any): Promise<AgentExecuteResult>;

  /**
   * Evaluate the agent's own output or another agent's output
   * Returns evaluation score and feedback
   */
  evaluate(output: any, expected?: any, context?: any): Promise<AgentEvaluateResult>;

  /**
   * Validate agent configuration
   * Returns true if the agent is properly configured
   */
  validate(): boolean;
}

/**
 * Base Agent Class implementing the formal agent contract
 * Provides common functionality for all agents
 */
export abstract class BaseAgent implements IAgent {
  public readonly id: string;
  public readonly type: string;
  protected capabilities: AgentCapabilities;

  constructor(id: string, type: string, capabilities: AgentCapabilities) {
    this.id = id;
    this.type = type;
    this.capabilities = capabilities;
  }

  getCapabilities(): AgentCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Plan execution for a given task
   * Must be implemented by concrete agents
   */
  abstract plan(task: any, context: any): Promise<AgentPlanResult>;

  /**
   * Execute a plan or task
   * Must be implemented by concrete agents
   */
  abstract execute(plan: any, context: any): Promise<AgentExecuteResult>;

  /**
   * Evaluate the agent's own output or another agent's output
   * Default implementation provides basic evaluation
   */
  async evaluate(output: any, expected?: any, context?: any): Promise<AgentEvaluateResult> {
    // Default evaluation: check if output matches expected
    let score = 0.5; // Neutral score
    let confidence = 0.5;
    let feedback = 'No specific evaluation performed';

    if (expected !== undefined) {
      if (JSON.stringify(output) === JSON.stringify(expected)) {
        score = 1.0;
        confidence = 1.0;
        feedback = 'Output matches expected result exactly';
      } else {
        score = 0.0;
        confidence = 0.8;
        feedback = 'Output does not match expected result';
      }
    }

    return {
      score,
      confidence,
      feedback,
      metrics: {
        outputSize: JSON.stringify(output).length,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * Validate agent configuration
   * Default validation checks capabilities
   */
  validate(): boolean {
    if (!this.id || typeof this.id !== 'string') {
      return false;
    }

    if (!this.type || typeof this.type !== 'string') {
      return false;
    }

    if (!Array.isArray(this.capabilities.capabilities)) {
      return false;
    }

    if (this.capabilities.maxConcurrentTasks <= 0) {
      return false;
    }

    return true;
  }
}

/**
 * Agent Registry for managing registered agents
 */
export class AgentRegistry {
  private agents: Map<string, IAgent> = new Map();

  /**
   * Register an agent
   */
  register(agent: IAgent): void {
    if (!agent.validate()) {
      throw new Error(`Agent ${agent.id} failed validation`);
    }
    this.agents.set(agent.id, agent);
  }

  /**
   * Unregister an agent
   */
  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  /**
   * Get an agent by ID
   */
  get(agentId: string): IAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAll(): IAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   */
  getByType(type: string): IAgent[] {
    return this.getAll().filter(agent => agent.type === type);
  }

  /**
   * Get agents by capability
   */
  getByCapability(capability: string): IAgent[] {
    return this.getAll().filter(agent =>
      agent.getCapabilities().capabilities.includes(capability)
    );
  }

  /**
   * Find best agent for a task based on capabilities
   */
  findBestAgent(requiredCapabilities: string[]): IAgent | undefined {
    const candidates = this.getAll().filter(agent => {
      const agentCapabilities = agent.getCapabilities().capabilities;
      return requiredCapabilities.every(cap => agentCapabilities.includes(cap));
    });

    if (candidates.length === 0) {
      return undefined;
    }

    // Simple selection: return the first candidate
    // In a more sophisticated implementation, this would use scoring, constraints, affinity, etc.
    return candidates[0];
  }

  /**
   * Clear all agents
   */
  clear(): void {
    this.agents.clear();
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalAgents: number;
    agentsByType: Record<string, number>;
    totalCapabilities: number;
  } {
    const agents = this.getAll();
    const agentsByType: Record<string, number> = {};

    for (const agent of agents) {
      agentsByType[agent.type] = (agentsByType[agent.type] || 0) + 1;
    }

    const totalCapabilities = agents.reduce(
      (sum, agent) => sum + agent.getCapabilities().capabilities.length,
      0
    );

    return {
      totalAgents: agents.length,
      agentsByType,
      totalCapabilities,
    };
  }
}

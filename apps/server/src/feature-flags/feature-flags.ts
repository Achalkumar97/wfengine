/**
 * Feature Flags System - Phase 0 Task 3
 * 
 * Provides feature flag system for gradual rollout of new multi-agent features.
 * This allows safe, incremental migration without breaking existing functionality.
 */

export enum FeatureFlag {
  // Phase 1: Foundation
  TOOL_SCHEMA_VALIDATION = 'tool_schema_validation',
  CONTEXT_MANAGER = 'context_manager',
  TOOL_VALIDATOR = 'tool_validator',
  
  // Phase 2: State Machine
  STATE_MACHINE_V2 = 'state_machine_v2',
  CHECKPOINT_SYSTEM = 'checkpoint_system',
  
  // Phase 3: Orchestration Kernel
  ORCHESTRATION_KERNEL = 'orchestration_kernel',
  SHARED_SEMANTICS = 'shared_semantics',
  EXECUTION_CONTRACTS = 'execution_contracts',
  
  // Phase 4: Agent Runtime
  FORMAL_AGENT_CONTRACT = 'formal_agent_contract',
  
  // Phase 5: Tool Execution
  TOOL_EXECUTION_MODES = 'tool_execution_modes',
  
  // Phase 6: Memory Layer
  KV_STORE_ONLY = 'kv_store_only',
  
  // Phase 7: Execution Graph
  EXECUTION_GRAPH = 'execution_graph',
  GRAPH_MUTATION = 'graph_mutation',
  GRAPH_ROLLBACK = 'graph_rollback',
  GRAPH_REPLAY = 'graph_replay',
  
  // Phase 8: Capability Registry
  CAPABILITY_REGISTRY = 'capability_registry',
  CAPABILITY_RESOLVER = 'capability_resolver',
  
  // Phase 9: Prompt Registry
  PROMPT_REGISTRY = 'prompt_registry',
  PROMPT_ARTIFACT = 'prompt_artifact',
  
  // Phase 10: Evaluation Framework
  EVALUATION_FRAMEWORK = 'evaluation_framework',
  SELF_EVALUATION = 'self_evaluation',
  TRAJECTORY_SCORING = 'trajectory_scoring',
  LOOP_DETECTION = 'loop_detection',
  
  // Phase 11: Policy Engine
  POLICY_ENGINE = 'policy_engine',
  PERMISSION_POLICIES = 'permission_policies',
  APPROVAL_GATES = 'approval_gates',
  
  // Phase 12: Cost Governance
  COST_GOVERNANCE = 'cost_governance',
  TOKEN_BUDGETING = 'token_budgeting',
  
  // Phase 13: Event Sourcing
  EVENT_SOURCING = 'event_sourcing',
  APPEND_ONLY_LOGS = 'append_only_logs',
  
  // Phase 14: Causal Tracing
  CAUSAL_TRACING = 'causal_tracing',
  CORRELATION_IDS = 'correlation_ids',
  
  // Phase 15: Production Hardening
  CIRCUIT_BREAKERS = 'circuit_breakers',
  RATE_LIMITING = 'rate_limiting',
}

export interface FeatureFlagConfig {
  enabled: boolean;
  rolloutPercentage?: number;
  allowedUsers?: string[];
  allowedTeams?: string[];
  description: string;
}

export class FeatureFlags {
  private flags: Map<FeatureFlag, FeatureFlagConfig> = new Map();

  constructor() {
    this.initializeDefaultFlags();
  }

  private initializeDefaultFlags(): void {
    // All features disabled by default for safe migration
    // Enable features gradually as they are implemented and tested
    
    Object.values(FeatureFlag).forEach((flag) => {
      this.flags.set(flag as FeatureFlag, {
        enabled: false,
        description: this.getFlagDescription(flag as FeatureFlag),
      });
    });
  }

  private getFlagDescription(flag: FeatureFlag): string {
    const descriptions: Record<FeatureFlag, string> = {
      [FeatureFlag.TOOL_SCHEMA_VALIDATION]: 'Enable strict tool schema validation',
      [FeatureFlag.CONTEXT_MANAGER]: 'Enable context manager with pruning',
      [FeatureFlag.TOOL_VALIDATOR]: 'Enable tool validator',
      [FeatureFlag.STATE_MACHINE_V2]: 'Enable new state machine with PAUSED state',
      [FeatureFlag.CHECKPOINT_SYSTEM]: 'Enable checkpoint system',
      [FeatureFlag.ORCHESTRATION_KERNEL]: 'Enable orchestration kernel',
      [FeatureFlag.SHARED_SEMANTICS]: 'Enable shared semantics for strategies',
      [FeatureFlag.EXECUTION_CONTRACTS]: 'Enable execution contracts',
      [FeatureFlag.FORMAL_AGENT_CONTRACT]: 'Enable formal agent contract',
      [FeatureFlag.TOOL_EXECUTION_MODES]: 'Enable tool execution modes (sync/async/streaming/detached)',
      [FeatureFlag.KV_STORE_ONLY]: 'Enable KV store only (no vector DB)',
      [FeatureFlag.EXECUTION_GRAPH]: 'Enable execution graph runtime',
      [FeatureFlag.GRAPH_MUTATION]: 'Enable graph mutation semantics',
      [FeatureFlag.GRAPH_ROLLBACK]: 'Enable graph rollback support',
      [FeatureFlag.GRAPH_REPLAY]: 'Enable graph replay support',
      [FeatureFlag.CAPABILITY_REGISTRY]: 'Enable capability registry',
      [FeatureFlag.CAPABILITY_RESOLVER]: 'Enable capability resolver',
      [FeatureFlag.PROMPT_REGISTRY]: 'Enable prompt registry',
      [FeatureFlag.PROMPT_ARTIFACT]: 'Enable prompt artifact with evaluation linkage',
      [FeatureFlag.EVALUATION_FRAMEWORK]: 'Enable evaluation framework',
      [FeatureFlag.SELF_EVALUATION]: 'Enable self-evaluation',
      [FeatureFlag.TRAJECTORY_SCORING]: 'Enable trajectory scoring',
      [FeatureFlag.LOOP_DETECTION]: 'Enable loop detection',
      [FeatureFlag.POLICY_ENGINE]: 'Enable policy engine',
      [FeatureFlag.PERMISSION_POLICIES]: 'Enable permission policies',
      [FeatureFlag.APPROVAL_GATES]: 'Enable approval gates',
      [FeatureFlag.COST_GOVERNANCE]: 'Enable cost governance',
      [FeatureFlag.TOKEN_BUDGETING]: 'Enable token budgeting',
      [FeatureFlag.EVENT_SOURCING]: 'Enable event sourcing',
      [FeatureFlag.APPEND_ONLY_LOGS]: 'Enable append-only execution logs',
      [FeatureFlag.CAUSAL_TRACING]: 'Enable causal tracing',
      [FeatureFlag.CORRELATION_IDS]: 'Enable correlation IDs',
      [FeatureFlag.CIRCUIT_BREAKERS]: 'Enable circuit breakers',
      [FeatureFlag.RATE_LIMITING]: 'Enable rate limiting',
    };
    
    return descriptions[flag] || 'No description';
  }

  /**
   * Check if a feature flag is enabled
   */
  isEnabled(flag: FeatureFlag, userId?: string): boolean {
    const config = this.flags.get(flag);
    
    if (!config || !config.enabled) {
      return false;
    }

    // Check user-specific allowlist
    if (userId && config.allowedUsers && !config.allowedUsers.includes(userId)) {
      return false;
    }

    // Check rollout percentage (simple random rollout)
    if (config.rolloutPercentage && config.rolloutPercentage < 100) {
      const hash = this.simpleHash(userId || flag);
      return (hash % 100) < config.rolloutPercentage;
    }

    return true;
  }

  /**
   * Enable a feature flag
   */
  enable(flag: FeatureFlag, config?: Partial<FeatureFlagConfig>): void {
    const current = this.flags.get(flag) || {
      enabled: false,
      description: this.getFlagDescription(flag),
    };
    
    this.flags.set(flag, {
      ...current,
      enabled: true,
      ...config,
    });
  }

  /**
   * Disable a feature flag
   */
  disable(flag: FeatureFlag): void {
    const current = this.flags.get(flag);
    if (current) {
      this.flags.set(flag, {
        ...current,
        enabled: false,
      });
    }
  }

  /**
   * Set feature flag configuration
   */
  setConfig(flag: FeatureFlag, config: Partial<FeatureFlagConfig>): void {
    const current = this.flags.get(flag) || {
      enabled: false,
      description: this.getFlagDescription(flag),
    };
    
    this.flags.set(flag, {
      ...current,
      ...config,
    });
  }

  /**
   * Get feature flag configuration
   */
  getConfig(flag: FeatureFlag): FeatureFlagConfig | undefined {
    return this.flags.get(flag);
  }

  /**
   * Get all feature flags
   */
  getAllFlags(): Map<FeatureFlag, FeatureFlagConfig> {
    return new Map(this.flags);
  }

  /**
   * Simple hash function for rollout percentage
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

// Global feature flags instance
export const featureFlags = new FeatureFlags();

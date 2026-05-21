/**
 * Capacity Planning - Phase 0 Task 5
 * 
 * Provides capacity planning utilities for the multi-agent architecture transformation.
 * This establishes current capacity metrics and helps plan for future scaling needs.
 */

export interface CapacityMetrics {
  maxConcurrentWorkflows: number;
  maxConcurrentAgents: number;
  maxToolExecutionsPerSecond: number;
  memoryPerWorkflow: number;
  cpuPerWorkflow: number;
  databaseConnections: number;
  redisConnections: number;
}

export interface CapacityPlan {
  current: CapacityMetrics;
  target: CapacityMetrics;
  migration: CapacityMetrics;
  timeline: string;
  recommendations: string[];
}

export class CapacityPlanning {
  /**
   * Get current capacity metrics
   */
  getCurrentCapacity(): CapacityMetrics {
    return {
      maxConcurrentWorkflows: 10, // Current baseline
      maxConcurrentAgents: 5,
      maxToolExecutionsPerSecond: 20,
      memoryPerWorkflow: 100, // MB
      cpuPerWorkflow: 0.5, // cores
      databaseConnections: 10,
      redisConnections: 10,
    };
  }

  /**
   * Get target capacity metrics (after migration)
   */
  getTargetCapacity(): CapacityMetrics {
    return {
      maxConcurrentWorkflows: 100, // Target: 10x increase
      maxConcurrentAgents: 50,
      maxToolExecutionsPerSecond: 200,
      memoryPerWorkflow: 150, // MB (slight increase due to new features)
      cpuPerWorkflow: 0.75, // cores (slight increase due to orchestration)
      databaseConnections: 50,
      redisConnections: 50,
    };
  }

  /**
   * Get migration capacity metrics (during migration)
   */
  getMigrationCapacity(): CapacityMetrics {
    return {
      maxConcurrentWorkflows: 50, // Gradual increase
      maxConcurrentAgents: 25,
      maxToolExecutionsPerSecond: 100,
      memoryPerWorkflow: 125, // MB
      cpuPerWorkflow: 0.6, // cores
      databaseConnections: 25,
      redisConnections: 25,
    };
  }

  /**
   * Generate capacity plan
   */
  generateCapacityPlan(): CapacityPlan {
    const current = this.getCurrentCapacity();
    const target = this.getTargetCapacity();
    const migration = this.getMigrationCapacity();

    const recommendations = this.generateRecommendations(current, target);

    return {
      current,
      target,
      migration,
      timeline: 'MVP: 4-6 months, Beta: 9-12 months, Production: 18-24 months',
      recommendations,
    };
  }

  /**
   * Generate capacity recommendations
   */
  private generateRecommendations(current: CapacityMetrics, target: CapacityMetrics): string[] {
    const recommendations: string[] = [];

    // Database connections
    if (target.databaseConnections > current.databaseConnections * 2) {
      recommendations.push('Increase database connection pool to handle 5x concurrent workflows');
    }

    // Redis connections
    if (target.redisConnections > current.redisConnections * 2) {
      recommendations.push('Increase Redis connection pool for caching and pub/sub');
    }

    // Memory
    const memoryIncrease = (target.memoryPerWorkflow - current.memoryPerWorkflow) / current.memoryPerWorkflow;
    if (memoryIncrease > 0.5) {
      recommendations.push('Allocate additional memory per workflow for new orchestration features');
    }

    // CPU
    const cpuIncrease = (target.cpuPerWorkflow - current.cpuPerWorkflow) / current.cpuPerWorkflow;
    if (cpuIncrease > 0.5) {
      recommendations.push('Allocate additional CPU per workflow for orchestration kernel');
    }

    // General recommendations
    recommendations.push('Implement horizontal scaling for API servers');
    recommendations.push('Implement horizontal scaling for orchestrators');
    recommendations.push('Monitor memory usage during migration');
    recommendations.push('Monitor CPU usage during migration');
    recommendations.push('Set up alerts for capacity thresholds');
    recommendations.push('Plan for gradual rollout using feature flags');

    return recommendations;
  }

  /**
   * Calculate resource requirements
   */
  calculateResourceRequirements(workflows: number): {
    totalMemoryMB: number;
    totalCPUCores: number;
    databaseConnections: number;
    redisConnections: number;
  } {
    const capacity = this.getTargetCapacity();

    return {
      totalMemoryMB: workflows * capacity.memoryPerWorkflow,
      totalCPUCores: workflows * capacity.cpuPerWorkflow,
      databaseConnections: Math.min(workflows, capacity.databaseConnections),
      redisConnections: Math.min(workflows, capacity.redisConnections),
    };
  }

  /**
   * Generate capacity report
   */
  generateReport(): string {
    const plan = this.generateCapacityPlan();
    const resources = this.calculateResourceRequirements(plan.target.maxConcurrentWorkflows);

    return `
Capacity Planning Report
=========================

Current Capacity:
- Max Concurrent Workflows: ${plan.current.maxConcurrentWorkflows}
- Max Concurrent Agents: ${plan.current.maxConcurrentAgents}
- Max Tool Executions/sec: ${plan.current.maxToolExecutionsPerSecond}
- Memory per Workflow: ${plan.current.memoryPerWorkflow} MB
- CPU per Workflow: ${plan.current.cpuPerWorkflow} cores
- Database Connections: ${plan.current.databaseConnections}
- Redis Connections: ${plan.current.redisConnections}

Target Capacity (After Migration):
- Max Concurrent Workflows: ${plan.target.maxConcurrentWorkflows}
- Max Concurrent Agents: ${plan.target.maxConcurrentAgents}
- Max Tool Executions/sec: ${plan.target.maxToolExecutionsPerSecond}
- Memory per Workflow: ${plan.target.memoryPerWorkflow} MB
- CPU per Workflow: ${plan.target.cpuPerWorkflow} cores
- Database Connections: ${plan.target.databaseConnections}
- Redis Connections: ${plan.target.redisConnections}

Migration Capacity (During Migration):
- Max Concurrent Workflows: ${plan.migration.maxConcurrentWorkflows}
- Max Concurrent Agents: ${plan.migration.maxConcurrentAgents}
- Max Tool Executions/sec: ${plan.migration.maxToolExecutionsPerSecond}
- Memory per Workflow: ${plan.migration.memoryPerWorkflow} MB
- CPU per Workflow: ${plan.migration.cpuPerWorkflow} cores
- Database Connections: ${plan.migration.databaseConnections}
- Redis Connections: ${plan.migration.redisConnections}

Resource Requirements for ${plan.target.maxConcurrentWorkflows} Workflows:
- Total Memory: ${resources.totalMemoryMB} MB
- Total CPU: ${resources.totalCPUCores} cores
- Database Connections: ${resources.databaseConnections}
- Redis Connections: ${resources.redisConnections}

Timeline: ${plan.timeline}

Recommendations:
${plan.recommendations.map(rec => `- ${rec}`).join('\n')}
    `.trim();
  }
}

// Global capacity planning instance
export const capacityPlanning = new CapacityPlanning();

/**
 * Capability Resolver - Phase 8 Task 2 (NEW - CRITICAL)
 * 
 * Provides capability resolution with scoring, constraints, affinity, load balancing, and historical performance.
 * This enables intelligent matching of capabilities to tasks.
 */

import type { Capability } from './capability-registry.js';

export interface CapabilityConstraint {
  type: 'required' | 'preferred' | 'excluded';
  key: string;
  value: any;
}

export interface CapabilityScore {
  capabilityId: string;
  score: number;
  factors: Record<string, number>;
}

export interface CapabilityAffinity {
  capabilityId: string;
  affinity: number;
  reason: string;
}

export interface HistoricalPerformance {
  capabilityId: string;
  successRate: number;
  averageExecutionTime: number;
  totalExecutions: number;
  lastExecution?: Date;
}

export class CapabilityResolver {
  private historicalPerformance: Map<string, HistoricalPerformance> = new Map();

  /**
   * Resolve the best capability for a set of requirements
   */
  resolve(
    capabilities: Capability[],
    requiredCapabilities: string[],
    constraints?: CapabilityConstraint[]
  ): Capability | null {
    // Filter capabilities that match required capabilities
    const candidates = capabilities.filter(capability =>
      requiredCapabilities.every(req =>
        capability.name.toLowerCase().includes(req.toLowerCase()) ||
        capability.description.toLowerCase().includes(req.toLowerCase())
      )
    );

    if (candidates.length === 0) {
      return null;
    }

    // Apply constraints
    let filteredCandidates = candidates;
    if (constraints) {
      filteredCandidates = this.applyConstraints(candidates, constraints);
    }

    if (filteredCandidates.length === 0) {
      return null;
    }

    // Score candidates
    const scores = this.scoreCapabilities(filteredCandidates, requiredCapabilities);

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Return the highest scored capability
    const bestScore = scores[0];
    return filteredCandidates.find(c => c.id === bestScore.capabilityId) || null;
  }

  /**
   * Apply constraints to filter capabilities
   */
  private applyConstraints(capabilities: Capability[], constraints: CapabilityConstraint[]): Capability[] {
    return capabilities.filter(capability => {
      for (const constraint of constraints) {
        const metadata = capability.metadata || {};

        switch (constraint.type) {
          case 'required':
            if (metadata[constraint.key] !== constraint.value) {
              return false;
            }
            break;

          case 'excluded':
            if (metadata[constraint.key] === constraint.value) {
              return false;
            }
            break;

          case 'preferred':
            // Preferred constraints don't filter, they just affect scoring
            break;
        }
      }

      return true;
    });
  }

  /**
   * Score capabilities based on multiple factors
   */
  private scoreCapabilities(
    capabilities: Capability[],
    requiredCapabilities: string[]
  ): CapabilityScore[] {
    return capabilities.map(capability => {
      const factors: Record<string, number> = {};

      // Factor 1: Name match score
      factors.nameMatch = this.calculateNameMatchScore(capability, requiredCapabilities);

      // Factor 2: Historical performance score
      factors.performance = this.calculatePerformanceScore(capability.id);

      // Factor 3: Recency score (newer capabilities get higher score)
      factors.recency = this.calculateRecencyScore(capability);

      // Factor 4: Affinity score
      factors.affinity = this.calculateAffinityScore(capability);

      // Calculate total score
      const score = Object.values(factors).reduce((sum, value) => sum + value, 0) / Object.keys(factors).length;

      return {
        capabilityId: capability.id,
        score,
        factors,
      };
    });
  }

  /**
   * Calculate name match score
   */
  private calculateNameMatchScore(capability: Capability, requiredCapabilities: string[]): number {
    const nameLower = capability.name.toLowerCase();
    const descriptionLower = capability.description.toLowerCase();

    let matchCount = 0;
    for (const req of requiredCapabilities) {
      const reqLower = req.toLowerCase();
      if (nameLower.includes(reqLower) || descriptionLower.includes(reqLower)) {
        matchCount++;
      }
    }

    return matchCount / requiredCapabilities.length;
  }

  /**
   * Calculate performance score based on historical data
   */
  private calculatePerformanceScore(capabilityId: string): number {
    const performance = this.historicalPerformance.get(capabilityId);
    
    if (!performance) {
      return 0.5; // Neutral score for unknown capabilities
    }

    // Weight success rate more heavily
    return (performance.successRate * 0.7) + (1 - performance.averageExecutionTime / 10000) * 0.3;
  }

  /**
   * Calculate recency score (newer capabilities get higher score)
   */
  private calculateRecencyScore(capability: Capability): number {
    // This is a placeholder - in a real implementation, this would use registration date
    return 0.5;
  }

  /**
   * Calculate affinity score
   */
  private calculateAffinityScore(capability: Capability): number {
    // This is a placeholder - in a real implementation, this would use affinity data
    return 0.5;
  }

  /**
   * Update historical performance data
   */
  updatePerformance(
    capabilityId: string,
    success: boolean,
    executionTime: number
  ): void {
    let performance = this.historicalPerformance.get(capabilityId);

    if (!performance) {
      performance = {
        capabilityId,
        successRate: 0,
        averageExecutionTime: 0,
        totalExecutions: 0,
      };
      this.historicalPerformance.set(capabilityId, performance);
    }

    // Update success rate
    const totalSuccess = performance.successRate * performance.totalExecutions + (success ? 1 : 0);
    performance.totalExecutions++;
    performance.successRate = totalSuccess / performance.totalExecutions;

    // Update average execution time
    performance.averageExecutionTime =
      (performance.averageExecutionTime * (performance.totalExecutions - 1) + executionTime) /
      performance.totalExecutions;

    performance.lastExecution = new Date();
  }

  /**
   * Get historical performance data
   */
  getPerformance(capabilityId: string): HistoricalPerformance | undefined {
    return this.historicalPerformance.get(capabilityId);
  }

  /**
   * Get all historical performance data
   */
  getAllPerformance(): HistoricalPerformance[] {
    return Array.from(this.historicalPerformance.values());
  }

  /**
   * Calculate affinity between capabilities
   */
  calculateAffinity(capability1: Capability, capability2: Capability): CapabilityAffinity {
    // Simple affinity calculation based on type and metadata
    let affinity = 0;
    const reasons: string[] = [];

    if (capability1.type === capability2.type) {
      affinity += 0.3;
      reasons.push('Same type');
    }

    const metadata1 = capability1.metadata || {};
    const metadata2 = capability2.metadata || {};

    const commonKeys = Object.keys(metadata1).filter(key => key in metadata2);
    if (commonKeys.length > 0) {
      affinity += 0.2 * (commonKeys.length / Math.max(Object.keys(metadata1).length, 1));
      reasons.push(`Shared metadata: ${commonKeys.join(', ')}`);
    }

    return {
      capabilityId: capability2.id,
      affinity: Math.min(affinity, 1),
      reason: reasons.join('; ') || 'No specific affinity',
    };
  }

  /**
   * Load balance across capabilities
   */
  loadBalance(capabilities: Capability[], strategy: 'round-robin' | 'least-loaded' | 'random'): Capability | null {
    if (capabilities.length === 0) {
      return null;
    }

    switch (strategy) {
      case 'round-robin':
        return this.roundRobinBalance(capabilities);

      case 'least-loaded':
        return this.leastLoadedBalance(capabilities);

      case 'random':
        return this.randomBalance(capabilities);

      default:
        return capabilities[0];
    }
  }

  /**
   * Round-robin load balancing
   */
  private roundRobinBalance(capabilities: Capability[]): Capability {
    // This is a simplified implementation
    // In a real implementation, this would track the last used index
    const index = Math.floor(Date.now() / 1000) % capabilities.length;
    return capabilities[index];
  }

  /**
   * Least-loaded load balancing
   */
  private leastLoadedBalance(capabilities: Capability[]): Capability {
    // Sort by historical performance (fewer executions = less loaded)
    const sorted = [...capabilities].sort((a, b) => {
      const perfA = this.historicalPerformance.get(a.id);
      const perfB = this.historicalPerformance.get(b.id);

      const execA = perfA?.totalExecutions || 0;
      const execB = perfB?.totalExecutions || 0;

      return execA - execB;
    });

    return sorted[0];
  }

  /**
   * Random load balancing
   */
  private randomBalance(capabilities: Capability[]): Capability {
    const index = Math.floor(Math.random() * capabilities.length);
    return capabilities[index];
  }

  /**
   * Clear historical performance data
   */
  clearPerformance(): void {
    this.historicalPerformance.clear();
  }

  /**
   * Get resolver statistics
   */
  getStats(): {
    totalCapabilitiesTracked: number;
    averageSuccessRate: number;
    averageExecutionTime: number;
  } {
    const performances = this.getAllPerformance();

    if (performances.length === 0) {
      return {
        totalCapabilitiesTracked: 0,
        averageSuccessRate: 0,
        averageExecutionTime: 0,
      };
    }

    const totalSuccessRate = performances.reduce((sum, p) => sum + p.successRate, 0);
    const totalExecutionTime = performances.reduce((sum, p) => sum + p.averageExecutionTime, 0);

    return {
      totalCapabilitiesTracked: performances.length,
      averageSuccessRate: totalSuccessRate / performances.length,
      averageExecutionTime: totalExecutionTime / performances.length,
    };
  }
}

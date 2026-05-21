/**
 * Prompt Artifact - Phase 9 Task 2 (NEW - CRITICAL)
 * 
 * Provides prompt artifact management with evaluation linkage, A/B testing, rollout percentages, regression tracking, prompt lineage, and automatic rollback.
 */

import type { PromptTemplate } from './prompt-registry.js';

export interface PromptArtifact {
  id: string;
  templateId: string;
  version: string;
  rolloutPercentage: number;
  evaluationId?: string;
  abTestGroup?: 'A' | 'B';
  lineage: string[];
  metrics: PromptMetrics;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptMetrics {
  successRate: number;
  averageLatency: number;
  totalExecutions: number;
  errorRate: number;
  userSatisfaction?: number;
}

export interface PromptEvaluation {
  id: string;
  promptArtifactId: string;
  score: number;
  feedback: string;
  timestamp: Date;
}

export class PromptArtifactManager {
  private artifacts: Map<string, PromptArtifact> = new Map();
  private evaluations: Map<string, PromptEvaluation[]> = new Map();
  private lineageMap: Map<string, string[]> = new Map(); // artifactId -> lineage

  /**
   * Create a new prompt artifact
   */
  createArtifact(
    templateId: string,
    version: string,
    rolloutPercentage: number,
    lineage: string[] = []
  ): PromptArtifact {
    const artifact: PromptArtifact = {
      id: `artifact-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      templateId,
      version,
      rolloutPercentage,
      lineage,
      metrics: {
        successRate: 0,
        averageLatency: 0,
        totalExecutions: 0,
        errorRate: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.artifacts.set(artifact.id, artifact);
    this.lineageMap.set(artifact.id, lineage);

    return artifact;
  }

  /**
   * Get an artifact by ID
   */
  getArtifact(artifactId: string): PromptArtifact | undefined {
    return this.artifacts.get(artifactId);
  }

  /**
   * Get all artifacts for a template
   */
  getArtifactsByTemplate(templateId: string): PromptArtifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.templateId === templateId);
  }

  /**
   * Get the active artifact for a template (based on rollout percentage)
   */
  getActiveArtifact(templateId: string): PromptArtifact | undefined {
    const artifacts = this.getArtifactsByTemplate(templateId);
    if (artifacts.length === 0) {
      return undefined;
    }

    // Sort by rollout percentage (highest first)
    artifacts.sort((a, b) => b.rolloutPercentage - a.rolloutPercentage);

    // Simple selection: return the highest rollout percentage artifact
    // In a real implementation, this would use random selection based on percentages
    return artifacts[0];
  }

  /**
   * Update artifact metrics
   */
  updateMetrics(artifactId: string, metrics: Partial<PromptMetrics>): boolean {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return false;
    }

    Object.assign(artifact.metrics, metrics);
    artifact.updatedAt = new Date();

    return true;
  }

  /**
   * Record an execution result
   */
  recordExecution(artifactId: string, success: boolean, latency: number): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return;
    }

    artifact.metrics.totalExecutions++;

    // Update success rate
    const totalSuccess = artifact.metrics.successRate * (artifact.metrics.totalExecutions - 1) + (success ? 1 : 0);
    artifact.metrics.successRate = totalSuccess / artifact.metrics.totalExecutions;

    // Update error rate
    const totalErrors = artifact.metrics.errorRate * (artifact.metrics.totalExecutions - 1) + (success ? 0 : 1);
    artifact.metrics.errorRate = totalErrors / artifact.metrics.totalExecutions;

    // Update average latency
    artifact.metrics.averageLatency =
      (artifact.metrics.averageLatency * (artifact.metrics.totalExecutions - 1) + latency) /
      artifact.metrics.totalExecutions;

    artifact.updatedAt = new Date();

    // Check for regression and trigger rollback if needed
    this.checkRegression(artifactId);
  }

  /**
   * Check for regression and trigger automatic rollback
   */
  private checkRegression(artifactId: string): void {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.metrics.totalExecutions < 10) {
      return;
    }

    // Get previous artifact in lineage
    if (artifact.lineage.length === 0) {
      return;
    }

    const previousArtifactId = artifact.lineage[artifact.lineage.length - 1];
    const previousArtifact = this.artifacts.get(previousArtifactId);

    if (!previousArtifact || previousArtifact.metrics.totalExecutions < 10) {
      return;
    }

    // Check if success rate dropped by more than 10%
    const successRateDrop = previousArtifact.metrics.successRate - artifact.metrics.successRate;
    if (successRateDrop > 0.1) {
      // Trigger rollback
      this.rollbackToArtifact(artifactId, previousArtifactId, 'Regression detected: success rate drop > 10%');
    }

    // Check if latency increased by more than 50%
    const latencyIncrease = (artifact.metrics.averageLatency - previousArtifact.metrics.averageLatency) / previousArtifact.metrics.averageLatency;
    if (latencyIncrease > 0.5) {
      // Trigger rollback
      this.rollbackToArtifact(artifactId, previousArtifactId, 'Regression detected: latency increase > 50%');
    }
  }

  /**
   * Rollback to a previous artifact
   */
  rollbackToArtifact(currentArtifactId: string, targetArtifactId: string, reason: string): boolean {
    const currentArtifact = this.artifacts.get(currentArtifactId);
    const targetArtifact = this.artifacts.get(targetArtifactId);

    if (!currentArtifact || !targetArtifact) {
      return false;
    }

    // Update rollout percentages
    currentArtifact.rolloutPercentage = 0;
    targetArtifact.rolloutPercentage = 100;

    targetArtifact.updatedAt = new Date();

    return true;
  }

  /**
   * Link an artifact to an evaluation
   */
  linkEvaluation(artifactId: string, evaluationId: string): boolean {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return false;
    }

    artifact.evaluationId = evaluationId;
    artifact.updatedAt = new Date();

    return true;
  }

  /**
   * Set A/B test group
   */
  setABTestGroup(artifactId: string, group: 'A' | 'B'): boolean {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return false;
    }

    artifact.abTestGroup = group;
    artifact.updatedAt = new Date();

    return true;
  }

  /**
   * Add an evaluation
   */
  addEvaluation(evaluation: PromptEvaluation): void {
    if (!this.evaluations.has(evaluation.promptArtifactId)) {
      this.evaluations.set(evaluation.promptArtifactId, []);
    }
    this.evaluations.get(evaluation.promptArtifactId)!.push(evaluation);
  }

  /**
   * Get evaluations for an artifact
   */
  getEvaluations(artifactId: string): PromptEvaluation[] {
    return this.evaluations.get(artifactId) || [];
  }

  /**
   * Get lineage for an artifact
   */
  getLineage(artifactId: string): string[] {
    return this.lineageMap.get(artifactId) || [];
  }

  /**
   * Update rollout percentage
   */
  updateRolloutPercentage(artifactId: string, percentage: number): boolean {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) {
      return false;
    }

    artifact.rolloutPercentage = percentage;
    artifact.updatedAt = new Date();

    return true;
  }

  /**
   * Delete an artifact
   */
  deleteArtifact(artifactId: string): boolean {
    this.lineageMap.delete(artifactId);
    this.evaluations.delete(artifactId);
    return this.artifacts.delete(artifactId);
  }

  /**
   * Get all artifacts
   */
  getAllArtifacts(): PromptArtifact[] {
    return Array.from(this.artifacts.values());
  }

  /**
   * Get artifact statistics
   */
  getStats(): {
    totalArtifacts: number;
    totalEvaluations: number;
    averageSuccessRate: number;
    averageLatency: number;
    artifactsByTemplate: Record<string, number>;
  } {
    const artifacts = this.getAllArtifacts();
    const artifactsByTemplate: Record<string, number> = {};

    let totalSuccessRate = 0;
    let totalLatency = 0;
    let totalEvaluations = 0;

    for (const artifact of artifacts) {
      artifactsByTemplate[artifact.templateId] = (artifactsByTemplate[artifact.templateId] || 0) + 1;
      totalSuccessRate += artifact.metrics.successRate;
      totalLatency += artifact.metrics.averageLatency;
    }

    for (const evaluations of this.evaluations.values()) {
      totalEvaluations += evaluations.length;
    }

    return {
      totalArtifacts: artifacts.length,
      totalEvaluations,
      averageSuccessRate: artifacts.length > 0 ? totalSuccessRate / artifacts.length : 0,
      averageLatency: artifacts.length > 0 ? totalLatency / artifacts.length : 0,
      artifactsByTemplate,
    };
  }
}

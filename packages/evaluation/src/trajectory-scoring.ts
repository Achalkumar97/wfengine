/**
 * Trajectory Scoring - Phase 10 Task 2
 * 
 * Provides trajectory scoring for agent execution paths.
 * This enables evaluation of agent decision-making and execution quality.
 */

export interface TrajectoryStep {
  stepId: string;
  agentId: string;
  action: string;
  input: any;
  output: any;
  timestamp: Date;
  duration: number;
  success: boolean;
}

export interface Trajectory {
  trajectoryId: string;
  steps: TrajectoryStep[];
  startTime: Date;
  endTime: Date;
  totalDuration: number;
}

export interface TrajectoryScore {
  trajectoryId: string;
  overallScore: number;
  efficiencyScore: number;
  correctnessScore: number;
  resourceUsageScore: number;
  decisionQualityScore: number;
  factors: Record<string, number>;
}

export class TrajectoryScorer {
  /**
   * Score a trajectory based on multiple factors
   */
  score(trajectory: Trajectory): TrajectoryScore {
    const factors: Record<string, number> = {};

    // Calculate efficiency score
    factors.efficiency = this.calculateEfficiency(trajectory);

    // Calculate correctness score
    factors.correctness = this.calculateCorrectness(trajectory);

    // Calculate resource usage score
    factors.resourceUsage = this.calculateResourceUsage(trajectory);

    // Calculate decision quality score
    factors.decisionQuality = this.calculateDecisionQuality(trajectory);

    // Calculate overall score
    const overallScore =
      (factors.efficiency * 0.25) +
      (factors.correctness * 0.35) +
      (factors.resourceUsage * 0.2) +
      (factors.decisionQuality * 0.2);

    return {
      trajectoryId: trajectory.trajectoryId,
      overallScore,
      efficiencyScore: factors.efficiency,
      correctnessScore: factors.correctness,
      resourceUsageScore: factors.resourceUsage,
      decisionQualityScore: factors.decisionQuality,
      factors,
    };
  }

  /**
   * Calculate efficiency score
   */
  private calculateEfficiency(trajectory: Trajectory): number {
    if (trajectory.steps.length === 0) {
      return 0.0;
    }

    // Efficiency is based on the ratio of successful steps to total steps
    const successfulSteps = trajectory.steps.filter(step => step.success).length;
    const successRate = successfulSteps / trajectory.steps.length;

    // Also consider the average duration per step
    const totalDuration = trajectory.steps.reduce((sum, step) => sum + step.duration, 0);
    const averageDuration = totalDuration / trajectory.steps.length;

    // Normalize duration (assuming 1 second is ideal)
    const durationScore = Math.max(0, 1 - averageDuration / 10000);

    return (successRate * 0.7) + (durationScore * 0.3);
  }

  /**
   * Calculate correctness score
   */
  private calculateCorrectness(trajectory: Trajectory): number {
    if (trajectory.steps.length === 0) {
      return 0.0;
    }

    // Correctness is based on the success rate of steps
    const successfulSteps = trajectory.steps.filter(step => step.success).length;
    return successfulSteps / trajectory.steps.length;
  }

  /**
   * Calculate resource usage score
   */
  private calculateResourceUsage(trajectory: Trajectory): number {
    if (trajectory.steps.length === 0) {
      return 0.0;
    }

    // Resource usage is based on the number of steps and total duration
    // Fewer steps and shorter duration = better resource usage
    const stepCount = trajectory.steps.length;
    const totalDuration = trajectory.totalDuration;

    // Normalize step count (assuming 10 steps is the baseline)
    const stepScore = Math.max(0, 1 - stepCount / 100);

    // Normalize duration (assuming 10 seconds is the baseline)
    const durationScore = Math.max(0, 1 - totalDuration / 10000);

    return (stepScore * 0.5) + (durationScore * 0.5);
  }

  /**
   * Calculate decision quality score
   */
  private calculateDecisionQuality(trajectory: Trajectory): number {
    if (trajectory.steps.length === 0) {
      return 0.0;
    }

    // Decision quality is based on the variety of actions and agent diversity
    const uniqueActions = new Set(trajectory.steps.map(step => step.action)).size;
    const uniqueAgents = new Set(trajectory.steps.map(step => step.agentId)).size;

    // More variety = better decision quality
    const actionVarietyScore = Math.min(1, uniqueActions / trajectory.steps.length);
    const agentVarietyScore = Math.min(1, uniqueAgents / trajectory.steps.length);

    return (actionVarietyScore * 0.5) + (agentVarietyScore * 0.5);
  }

  /**
   * Compare two trajectories
   */
  compare(trajectory1: Trajectory, trajectory2: Trajectory): {
    better: 'trajectory1' | 'trajectory2' | 'equal';
    scoreDifference: number;
    comparison: Record<string, number>;
  } {
    const score1 = this.score(trajectory1);
    const score2 = this.score(trajectory2);

    const comparison: Record<string, number> = {
      efficiency: score1.efficiencyScore - score2.efficiencyScore,
      correctness: score1.correctnessScore - score2.correctnessScore,
      resourceUsage: score1.resourceUsageScore - score2.resourceUsageScore,
      decisionQuality: score1.decisionQualityScore - score2.decisionQualityScore,
    };

    const scoreDifference = score1.overallScore - score2.overallScore;

    let better: 'trajectory1' | 'trajectory2' | 'equal';
    if (Math.abs(scoreDifference) < 0.01) {
      better = 'equal';
    } else if (scoreDifference > 0) {
      better = 'trajectory1';
    } else {
      better = 'trajectory2';
    }

    return {
      better,
      scoreDifference,
      comparison,
    };
  }

  /**
   * Batch score multiple trajectories
   */
  batchScore(trajectories: Trajectory[]): TrajectoryScore[] {
    return trajectories.map(trajectory => this.score(trajectory));
  }

  /**
   * Get trajectory statistics
   */
  getStats(trajectories: Trajectory[]): {
    totalTrajectories: number;
    averageSteps: number;
    averageDuration: number;
    averageSuccessRate: number;
  } {
    if (trajectories.length === 0) {
      return {
        totalTrajectories: 0,
        averageSteps: 0,
        averageDuration: 0,
        averageSuccessRate: 0,
      };
    }

    const totalSteps = trajectories.reduce((sum, t) => sum + t.steps.length, 0);
    const totalDuration = trajectories.reduce((sum, t) => sum + t.totalDuration, 0);
    
    let totalSuccesses = 0;
    let totalStepsCount = 0;
    for (const trajectory of trajectories) {
      const successes = trajectory.steps.filter(step => step.success).length;
      totalSuccesses += successes;
      totalStepsCount += trajectory.steps.length;
    }

    return {
      totalTrajectories: trajectories.length,
      averageSteps: totalSteps / trajectories.length,
      averageDuration: totalDuration / trajectories.length,
      averageSuccessRate: totalStepsCount > 0 ? totalSuccesses / totalStepsCount : 0,
    };
  }

  /**
   * Find the best trajectory from a set
   */
  findBest(trajectories: Trajectory[]): Trajectory | null {
    if (trajectories.length === 0) {
      return null;
    }

    const scores = this.batchScore(trajectories);
    let bestIndex = 0;
    let bestScore = scores[0].overallScore;

    for (let i = 1; i < scores.length; i++) {
      if (scores[i].overallScore > bestScore) {
        bestScore = scores[i].overallScore;
        bestIndex = i;
      }
    }

    return trajectories[bestIndex];
  }
}

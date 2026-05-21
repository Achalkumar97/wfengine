/**
 * Loop Detection - Phase 10 Task 3
 * 
 * Provides loop detection for agent execution trajectories.
 * This enables detection of repetitive patterns and infinite loops.
 */

import type { Trajectory, TrajectoryStep } from './trajectory-scoring.js';

export interface LoopPattern {
  pattern: string[];
  occurrences: number;
  startIndices: number[];
  severity: 'low' | 'medium' | 'high';
}

export interface LoopDetectionResult {
  hasLoops: boolean;
  patterns: LoopPattern[];
  totalLoops: number;
  severity: 'low' | 'medium' | 'high';
}

export class LoopDetector {
  private maxPatternLength: number = 5;
  private minOccurrences: number = 2;

  /**
   * Detect loops in a trajectory
   */
  detect(trajectory: Trajectory): LoopDetectionResult {
    const patterns: LoopPattern[] = [];
    const actions = trajectory.steps.map(step => step.action);

    // Detect repeating patterns
    for (let length = 2; length <= this.maxPatternLength; length++) {
      const patternMap = new Map<string, number[]>();

      for (let i = 0; i <= actions.length - length; i++) {
        const pattern = actions.slice(i, i + length).join('->');
        
        if (!patternMap.has(pattern)) {
          patternMap.set(pattern, []);
        }
        patternMap.get(pattern)!.push(i);
      }

      // Find patterns that occur multiple times
      for (const [pattern, indices] of patternMap.entries()) {
        if (indices.length >= this.minOccurrences) {
          const severity = this.calculateSeverity(indices.length, length);
          patterns.push({
            pattern: pattern.split('->'),
            occurrences: indices.length,
            startIndices: indices,
            severity,
          });
        }
      }
    }

    // Calculate overall severity
    const severity = this.calculateOverallSeverity(patterns);

    return {
      hasLoops: patterns.length > 0,
      patterns,
      totalLoops: patterns.length,
      severity,
    };
  }

  /**
   * Calculate severity based on occurrences and pattern length
   */
  private calculateSeverity(occurrences: number, patternLength: number): 'low' | 'medium' | 'high' {
    const score = occurrences * patternLength;

    if (score >= 10) {
      return 'high';
    } else if (score >= 5) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Calculate overall severity from all patterns
   */
  private calculateOverallSeverity(patterns: LoopPattern[]): 'low' | 'medium' | 'high' {
    if (patterns.length === 0) {
      return 'low';
    }

    const highSeverityCount = patterns.filter(p => p.severity === 'high').length;
    const mediumSeverityCount = patterns.filter(p => p.severity === 'medium').length;

    if (highSeverityCount > 0) {
      return 'high';
    } else if (mediumSeverityCount >= 2) {
      return 'high';
    } else if (mediumSeverityCount > 0) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Detect infinite loops (same action repeated many times)
   */
  detectInfiniteLoop(trajectory: Trajectory, threshold: number = 10): boolean {
    if (trajectory.steps.length < threshold) {
      return false;
    }

    const lastActions = trajectory.steps.slice(-threshold).map(step => step.action);
    const firstAction = lastActions[0];

    // Check if all actions are the same
    return lastActions.every(action => action === firstAction);
  }

  /**
   * Detect state loops (same state repeated)
   */
  detectStateLoop(trajectory: Trajectory, threshold: number = 5): boolean {
    if (trajectory.steps.length < threshold) {
      return false;
    }

    const states = trajectory.steps.map(step => JSON.stringify(step.output));
    const lastStates = states.slice(-threshold);
    const firstState = lastStates[0];

    // Check if all states are the same
    return lastStates.every(state => state === firstState);
  }

  /**
   * Detect action loops (sequence of actions repeated)
   */
  detectActionLoop(trajectory: Trajectory, patternLength: number = 3, threshold: number = 2): LoopPattern | null {
    const actions = trajectory.steps.map(step => step.action);

    for (let i = 0; i <= actions.length - patternLength * threshold; i++) {
      const pattern = actions.slice(i, i + patternLength);
      let matchCount = 1;

      for (let j = i + patternLength; j <= actions.length - patternLength; j += patternLength) {
        const nextPattern = actions.slice(j, j + patternLength);
        if (JSON.stringify(pattern) === JSON.stringify(nextPattern)) {
          matchCount++;
          if (matchCount >= threshold) {
            return {
              pattern,
              occurrences: matchCount,
              startIndices: [i, j],
              severity: this.calculateSeverity(matchCount, patternLength),
            };
          }
        } else {
          break;
        }
      }
    }

    return null;
  }

  /**
   * Get loop statistics
   */
  getStats(trajectories: Trajectory[]): {
    totalTrajectories: number;
    trajectoriesWithLoops: number;
    averageLoopsPerTrajectory: number;
    severityDistribution: Record<string, number>;
  } {
    if (trajectories.length === 0) {
      return {
        totalTrajectories: 0,
        trajectoriesWithLoops: 0,
        averageLoopsPerTrajectory: 0,
        severityDistribution: { low: 0, medium: 0, high: 0 },
      };
    }

    const results = trajectories.map(t => this.detect(t));
    const trajectoriesWithLoops = results.filter(r => r.hasLoops).length;
    const totalLoops = results.reduce((sum, r) => sum + r.totalLoops, 0);

    const severityDistribution: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
    };

    for (const result of results) {
      severityDistribution[result.severity]++;
    }

    return {
      totalTrajectories: trajectories.length,
      trajectoriesWithLoops,
      averageLoopsPerTrajectory: totalLoops / trajectories.length,
      severityDistribution,
    };
  }

  /**
   * Set maximum pattern length
   */
  setMaxPatternLength(length: number): void {
    this.maxPatternLength = length;
  }

  /**
   * Set minimum occurrences
   */
  setMinOccurrences(occurrences: number): void {
    this.minOccurrences = occurrences;
  }

  /**
   * Get configuration
   */
  getConfig(): {
    maxPatternLength: number;
    minOccurrences: number;
  } {
    return {
      maxPatternLength: this.maxPatternLength,
      minOccurrences: this.minOccurrences,
    };
  }
}

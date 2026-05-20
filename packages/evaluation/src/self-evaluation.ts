/**
 * Self-Evaluation - Phase 10 Task 1
 * 
 * Provides self-evaluation capabilities for agents to assess their own outputs.
 * This enables agents to evaluate their performance and improve over time.
 */

export interface SelfEvaluationResult {
  score: number;
  confidence: number;
  reasoning: string;
  metrics: Record<string, number>;
}

export interface EvaluationCriteria {
  accuracy: number;
  completeness: number;
  relevance: number;
  clarity: number;
  efficiency: number;
}

export class SelfEvaluator {
  /**
   * Evaluate an agent's output against expected results
   */
  evaluate(
    output: any,
    expected?: any,
    criteria?: Partial<EvaluationCriteria>
  ): SelfEvaluationResult {
    const defaultCriteria: EvaluationCriteria = {
      accuracy: 1.0,
      completeness: 1.0,
      relevance: 1.0,
      clarity: 1.0,
      efficiency: 1.0,
      ...criteria,
    };

    const metrics: Record<string, number> = {};

    // Calculate accuracy if expected is provided
    if (expected !== undefined) {
      metrics.accuracy = this.calculateAccuracy(output, expected);
    } else {
      metrics.accuracy = 0.5; // Neutral if no expected value
    }

    // Calculate completeness
    metrics.completeness = this.calculateCompleteness(output);

    // Calculate relevance
    metrics.relevance = this.calculateRelevance(output);

    // Calculate clarity
    metrics.clarity = this.calculateClarity(output);

    // Calculate efficiency (placeholder)
    metrics.efficiency = 0.5;

    // Calculate weighted score
    const score =
      metrics.accuracy * defaultCriteria.accuracy +
      metrics.completeness * defaultCriteria.completeness +
      metrics.relevance * defaultCriteria.relevance +
      metrics.clarity * defaultCriteria.clarity +
      metrics.efficiency * defaultCriteria.efficiency;

    const totalWeight =
      defaultCriteria.accuracy +
      defaultCriteria.completeness +
      defaultCriteria.relevance +
      defaultCriteria.clarity +
      defaultCriteria.efficiency;

    const normalizedScore = score / totalWeight;

    // Calculate confidence based on output quality
    const confidence = this.calculateConfidence(output, metrics);

    // Generate reasoning
    const reasoning = this.generateReasoning(metrics, normalizedScore);

    return {
      score: normalizedScore,
      confidence,
      reasoning,
      metrics,
    };
  }

  /**
   * Calculate accuracy score
   */
  private calculateAccuracy(output: any, expected: any): number {
    if (output === expected) {
      return 1.0;
    }

    if (typeof output === 'object' && typeof expected === 'object') {
      const outputStr = JSON.stringify(output);
      const expectedStr = JSON.stringify(expected);
      
      // Simple similarity calculation
      const similarity = this.calculateSimilarity(outputStr, expectedStr);
      return similarity;
    }

    // For non-object types, return 0 if not equal
    return 0.0;
  }

  /**
   * Calculate string similarity
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    
    const longer = Math.max(str1.length, str2.length);
    if (longer === 0) return 1.0;
    
    const editDistance = this.calculateEditDistance(str1, str2);
    return 1 - editDistance / longer;
  }

  /**
   * Calculate Levenshtein edit distance
   */
  private calculateEditDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Calculate completeness score
   */
  private calculateCompleteness(output: any): number {
    if (output === null || output === undefined) {
      return 0.0;
    }

    if (typeof output === 'object') {
      const keys = Object.keys(output);
      if (keys.length === 0) {
        return 0.0;
      }
      
      // Check if all values are non-null
      const nonNullCount = keys.filter(key => output[key] !== null && output[key] !== undefined).length;
      return nonNullCount / keys.length;
    }

    if (typeof output === 'string' && output.trim() === '') {
      return 0.0;
    }

    return 1.0;
  }

  /**
   * Calculate relevance score
   */
  private calculateRelevance(output: any): number {
    // Placeholder implementation
    // In a real implementation, this would use context and task requirements
    return 0.5;
  }

  /**
   * Calculate clarity score
   */
  private calculateClarity(output: any): number {
    if (typeof output === 'string') {
      // Check for clarity indicators
      const hasStructure = /[.!?]/.test(output);
      const hasLength = output.length > 10;
      return (hasStructure ? 0.5 : 0) + (hasLength ? 0.5 : 0);
    }

    if (typeof output === 'object') {
      // Check for clear structure
      const keys = Object.keys(output);
      return keys.length > 0 ? 0.8 : 0.2;
    }

    return 0.5;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(output: any, metrics: Record<string, number>): number {
    // Confidence is based on the consistency of metrics
    const values = Object.values(metrics);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Lower standard deviation = higher confidence
    return Math.max(0, 1 - stdDev);
  }

  /**
   * Generate reasoning for the evaluation
   */
  private generateReasoning(metrics: Record<string, number>, score: number): string {
    const parts: string[] = [];

    if (metrics.accuracy >= 0.8) {
      parts.push('High accuracy');
    } else if (metrics.accuracy >= 0.5) {
      parts.push('Moderate accuracy');
    } else {
      parts.push('Low accuracy');
    }

    if (metrics.completeness >= 0.8) {
      parts.push('Complete output');
    } else if (metrics.completeness >= 0.5) {
      parts.push('Partially complete');
    } else {
      parts.push('Incomplete output');
    }

    if (score >= 0.8) {
      parts.push('Overall excellent performance');
    } else if (score >= 0.6) {
      parts.push('Overall good performance');
    } else if (score >= 0.4) {
      parts.push('Overall moderate performance');
    } else {
      parts.push('Overall poor performance');
    }

    return parts.join('; ');
  }

  /**
   * Batch evaluate multiple outputs
   */
  batchEvaluate(
    outputs: Array<{ output: any; expected?: any; criteria?: Partial<EvaluationCriteria> }>
  ): SelfEvaluationResult[] {
    return outputs.map(({ output, expected, criteria }) =>
      this.evaluate(output, expected, criteria)
    );
  }

  /**
   * Get evaluation statistics
   */
  getStats(evaluations: SelfEvaluationResult[]): {
    averageScore: number;
    averageConfidence: number;
    minScore: number;
    maxScore: number;
    totalEvaluations: number;
  } {
    if (evaluations.length === 0) {
      return {
        averageScore: 0,
        averageConfidence: 0,
        minScore: 0,
        maxScore: 0,
        totalEvaluations: 0,
      };
    }

    const scores = evaluations.map(e => e.score);
    const confidences = evaluations.map(e => e.confidence);

    return {
      averageScore: scores.reduce((sum, s) => sum + s, 0) / scores.length,
      averageConfidence: confidences.reduce((sum, c) => sum + c, 0) / confidences.length,
      minScore: Math.min(...scores),
      maxScore: Math.max(...scores),
      totalEvaluations: evaluations.length,
    };
  }
}

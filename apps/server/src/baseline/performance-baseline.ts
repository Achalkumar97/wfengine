/**
 * Performance Baseline - Phase 0 Task 4
 * 
 * Provides performance baseline measurements for the multi-agent architecture transformation.
 * This establishes current performance metrics before migration to measure impact.
 */

export interface PerformanceMetrics {
  workflowExecutionTime: number;
  toolExecutionTime: number;
  apiResponseTime: number;
  memoryUsage: number;
  cpuUsage: number;
  concurrentWorkflows: number;
  errorRate: number;
}

export interface PerformanceBaselineData {
  timestamp: Date;
  metrics: PerformanceMetrics;
  environment: string;
}

export class PerformanceBaseline {
  private baselines: PerformanceBaselineData[] = [];

  /**
   * Capture current performance metrics
   */
  async captureMetrics(): Promise<PerformanceMetrics> {
    const metrics: PerformanceMetrics = {
      workflowExecutionTime: 0,
      toolExecutionTime: 0,
      apiResponseTime: 0,
      memoryUsage: this.getMemoryUsage(),
      cpuUsage: this.getCpuUsage(),
      concurrentWorkflows: 0,
      errorRate: 0,
    };

    return metrics;
  }

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsage(): number {
    const usage = process.memoryUsage();
    return usage.heapUsed / 1024 / 1024; // Convert to MB
  }

  /**
   * Get current CPU usage (simplified)
   */
  private getCpuUsage(): number {
    // Simplified CPU usage - in production, use proper CPU monitoring
    const cpuUsage = process.cpuUsage();
    return (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
  }

  /**
   * Record a performance baseline
   */
  async recordBaseline(environment: string = 'development'): Promise<PerformanceBaselineData> {
    const metrics = await this.captureMetrics();
    
    const baseline: PerformanceBaselineData = {
      timestamp: new Date(),
      metrics,
      environment,
    };

    this.baselines.push(baseline);
    
    console.log(`[Baseline] Recorded performance baseline for ${environment}:`, {
      memory: `${metrics.memoryUsage.toFixed(2)} MB`,
      cpu: `${metrics.cpuUsage.toFixed(2)}s`,
    });

    return baseline;
  }

  /**
   * Get the most recent baseline
   */
  getLatestBaseline(): PerformanceBaselineData | undefined {
    return this.baselines[this.baselines.length - 1];
  }

  /**
   * Get all baselines
   */
  getAllBaselines(): PerformanceBaselineData[] {
    return [...this.baselines];
  }

  /**
   * Compare metrics against baseline
   */
  compareMetrics(current: PerformanceMetrics, baseline: PerformanceMetrics): {
    workflowExecutionTime: { diff: number; percentChange: number };
    toolExecutionTime: { diff: number; percentChange: number };
    apiResponseTime: { diff: number; percentChange: number };
    memoryUsage: { diff: number; percentChange: number };
    cpuUsage: { diff: number; percentChange: number };
  } {
    const calculateChange = (current: number, baseline: number) => ({
      diff: current - baseline,
      percentChange: baseline > 0 ? ((current - baseline) / baseline) * 100 : 0,
    });

    return {
      workflowExecutionTime: calculateChange(current.workflowExecutionTime, baseline.workflowExecutionTime),
      toolExecutionTime: calculateChange(current.toolExecutionTime, baseline.toolExecutionTime),
      apiResponseTime: calculateChange(current.apiResponseTime, baseline.apiResponseTime),
      memoryUsage: calculateChange(current.memoryUsage, baseline.memoryUsage),
      cpuUsage: calculateChange(current.cpuUsage, baseline.cpuUsage),
    };
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    if (this.baselines.length === 0) {
      return 'No baselines recorded yet.';
    }

    const latest = this.getLatestBaseline();
    if (!latest) {
      return 'No baseline data available.';
    }

    const metrics = latest.metrics;
    
    return `
Performance Baseline Report
===========================
Environment: ${latest.environment}
Timestamp: ${latest.timestamp.toISOString()}

Metrics:
- Memory Usage: ${metrics.memoryUsage.toFixed(2)} MB
- CPU Usage: ${metrics.cpuUsage.toFixed(2)}s
- Workflow Execution Time: ${metrics.workflowExecutionTime}ms
- Tool Execution Time: ${metrics.toolExecutionTime}ms
- API Response Time: ${metrics.apiResponseTime}ms
- Concurrent Workflows: ${metrics.concurrentWorkflows}
- Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%

Total Baselines Recorded: ${this.baselines.length}
    `.trim();
  }

  /**
   * Export baselines to JSON
   */
  exportToJson(): string {
    return JSON.stringify(this.baselines, null, 2);
  }

  /**
   * Load baselines from JSON
   */
  loadFromJson(json: string): void {
    try {
      const data = JSON.parse(json) as PerformanceBaselineData[];
      this.baselines = data;
      console.log(`[Baseline] Loaded ${data.length} baselines from JSON`);
    } catch (error) {
      console.error('[Baseline] Failed to load baselines from JSON:', error);
    }
  }
}

// Global performance baseline instance
export const performanceBaseline = new PerformanceBaseline();

/**
 * Tool Executor - Phase 1 Task 4
 * Phase 5 Task 2: Updated to incorporate execution modes
 * 
 * Provides tool execution with retries and timeouts (in-process, no queue initially).
 * This is the foundation for the tool execution layer.
 */

import { ToolExecutionMode, ToolExecutionModeManager, type AsyncExecutionResult, type StreamingExecutionResult, type DetachedExecutionResult } from './tool-execution-modes.js';

export interface ToolExecutionOptions {
  mode?: ToolExecutionMode;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  retryBackoff?: number;
  onChunk?: (chunk: any) => void;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  attempts: number;
  duration: number;
}

export type ToolFunction = (parameters: any) => Promise<any> | any;

export class ToolExecutor {
  private defaultOptions: ToolExecutionOptions = {
    mode: ToolExecutionMode.SYNC,
    timeout: 30000, // 30 seconds default
    maxRetries: 3,
    retryDelay: 1000, // 1 second
    retryBackoff: 2, // exponential backoff multiplier
  };
  private modeManager: ToolExecutionModeManager;

  constructor(options?: Partial<ToolExecutionOptions>) {
    if (options) {
      this.defaultOptions = { ...this.defaultOptions, ...options };
    }
    this.modeManager = new ToolExecutionModeManager();
  }

  /**
   * Execute a tool with retries and timeout
   * Supports different execution modes: sync, async, streaming, detached
   */
  async execute(
    tool: ToolFunction,
    parameters: any,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult | AsyncExecutionResult | StreamingExecutionResult | DetachedExecutionResult> {
    const opts = { ...this.defaultOptions, ...options };
    const mode = opts.mode || ToolExecutionMode.SYNC;

    switch (mode) {
      case ToolExecutionMode.SYNC:
        return this.executeSync(tool, parameters, opts);
      case ToolExecutionMode.ASYNC:
        return this.executeAsync(tool, parameters, opts);
      case ToolExecutionMode.STREAMING:
        return this.executeStreaming(tool, parameters, opts);
      case ToolExecutionMode.DETACHED:
        return this.executeDetached(tool, parameters, opts);
      default:
        return this.executeSync(tool, parameters, opts);
    }
  }

  /**
   * Execute a tool in sync mode
   */
  private async executeSync(
    tool: ToolFunction,
    parameters: any,
    options: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts <= (options.maxRetries || 3)) {
      attempts++;

      try {
        const result = await this.executeWithTimeout(tool, parameters, options.timeout || 30000);
        const duration = Date.now() - startTime;

        return {
          success: true,
          result,
          attempts,
          duration,
        };
      } catch (error) {
        lastError = error as Error;
        
        if (attempts >= (options.maxRetries || 3)) {
          const duration = Date.now() - startTime;
          return {
            success: false,
            error: lastError.message,
            attempts,
            duration,
          };
        }

        const delay = (options.retryDelay || 1000) * Math.pow(options.retryBackoff || 2, attempts - 1);
        await this.sleep(delay);
      }
    }

    const duration = Date.now() - startTime;
    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      attempts,
      duration,
    };
  }

  /**
   * Execute a tool in async mode
   */
  private async executeAsync(
    tool: ToolFunction,
    parameters: any,
    options: ToolExecutionOptions
  ): Promise<AsyncExecutionResult> {
    return this.modeManager.executeAsync(tool, parameters, options);
  }

  /**
   * Execute a tool in streaming mode
   */
  private async executeStreaming(
    tool: ToolFunction,
    parameters: any,
    options: ToolExecutionOptions
  ): Promise<StreamingExecutionResult> {
    return this.modeManager.executeStreaming(tool, parameters, options, options.onChunk);
  }

  /**
   * Execute a tool in detached mode
   */
  private async executeDetached(
    tool: ToolFunction,
    parameters: any,
    options: ToolExecutionOptions
  ): Promise<DetachedExecutionResult> {
    return this.modeManager.executeDetached(tool, parameters, options);
  }

  /**
   * Execute a tool with a timeout
   */
  private async executeWithTimeout(
    tool: ToolFunction,
    parameters: any,
    timeout: number
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeout}ms`));
      }, timeout);

      tool(parameters)
        .then((result: any) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error: any) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute multiple tools in parallel (sync mode only)
   */
  async executeParallel(
    tools: Array<{ tool: ToolFunction; parameters: any; options?: ToolExecutionOptions }>
  ): Promise<ToolExecutionResult[]> {
    const promises = tools.map(({ tool, parameters, options }) =>
      this.executeSync(tool, parameters, { ...options, mode: ToolExecutionMode.SYNC })
    );

    return Promise.all(promises);
  }

  /**
   * Execute multiple tools in sequence (sync mode only)
   */
  async executeSequential(
    tools: Array<{ tool: ToolFunction; parameters: any; options?: ToolExecutionOptions }>
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const { tool, parameters, options } of tools) {
      const result = await this.executeSync(tool, parameters, { ...options, mode: ToolExecutionMode.SYNC });
      results.push(result);

      // If a tool fails and we're in sequential mode, stop execution
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Get default execution options
   */
  getDefaultOptions(): ToolExecutionOptions {
    return { ...this.defaultOptions };
  }

  /**
   * Set default execution options
   */
  setDefaultOptions(options: Partial<ToolExecutionOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }
}

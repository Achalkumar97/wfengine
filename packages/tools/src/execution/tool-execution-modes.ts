/**
 * Tool Execution Modes - Phase 5 Task 1 (NEW - CRITICAL)
 * 
 * Defines distinct tool execution modes: sync, async, streaming, detached.
 * This provides flexibility for different tool execution patterns.
 */

export enum ToolExecutionMode {
  SYNC = 'sync',
  ASYNC = 'async',
  STREAMING = 'streaming',
  DETACHED = 'detached',
}

export interface ToolExecutionOptions {
  mode: ToolExecutionMode;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  retryBackoff?: number;
}

export interface SyncExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  attempts: number;
  duration: number;
}

export interface AsyncExecutionResult {
  executionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface StreamingExecutionResult {
  executionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  chunks: any[];
  result?: any;
  error?: string;
}

export interface DetachedExecutionResult {
  executionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  canCancel: boolean;
}

export class ToolExecutionModeManager {
  private executions: Map<string, any> = new Map();

  /**
   * Execute a tool in sync mode
   * Blocks until completion
   */
  async executeSync(
    tool: Function,
    parameters: any,
    options: Partial<ToolExecutionOptions> = {}
  ): Promise<SyncExecutionResult> {
    const startTime = Date.now();
    const opts: ToolExecutionOptions = {
      mode: ToolExecutionMode.SYNC,
      timeout: options.timeout || 30000,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      retryBackoff: options.retryBackoff || 2,
    };

    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts <= opts.maxRetries!) {
      attempts++;

      try {
        const result = await this.executeWithTimeout(tool, parameters, opts.timeout!);
        const duration = Date.now() - startTime;

        return {
          success: true,
          result,
          attempts,
          duration,
        };
      } catch (error) {
        lastError = error as Error;

        if (attempts >= opts.maxRetries!) {
          const duration = Date.now() - startTime;
          return {
            success: false,
            error: lastError.message,
            attempts,
            duration,
          };
        }

        const delay = opts.retryDelay! * Math.pow(opts.retryBackoff!, attempts - 1);
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
   * Returns immediately with execution ID
   */
  async executeAsync(
    tool: Function,
    parameters: any,
    options: Partial<ToolExecutionOptions> = {}
  ): Promise<AsyncExecutionResult> {
    const executionId = `async-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.executions.set(executionId, {
      status: 'pending',
      tool,
      parameters,
      options,
    });

    // Execute in background
    this.executeAsyncTask(executionId).catch(error => {
      console.error(`Async execution ${executionId} failed:`, error);
    });

    return {
      executionId,
      status: 'pending',
    };
  }

  /**
   * Execute a tool in streaming mode
   * Returns execution ID and streams chunks
   */
  async executeStreaming(
    tool: Function,
    parameters: any,
    options: Partial<ToolExecutionOptions> = {},
    onChunk?: (chunk: any) => void
  ): Promise<StreamingExecutionResult> {
    const executionId = `streaming-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.executions.set(executionId, {
      status: 'pending',
      tool,
      parameters,
      options,
      chunks: [],
      onChunk,
    });

    // Execute in background with streaming
    this.executeStreamingTask(executionId).catch(error => {
      console.error(`Streaming execution ${executionId} failed:`, error);
    });

    return {
      executionId,
      status: 'pending',
      chunks: [],
    };
  }

  /**
   * Execute a tool in detached mode
   * Returns immediately with execution ID and cancellation capability
   */
  async executeDetached(
    tool: Function,
    parameters: any,
    options: Partial<ToolExecutionOptions> = {}
  ): Promise<DetachedExecutionResult> {
    const executionId = `detached-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.executions.set(executionId, {
      status: 'pending',
      tool,
      parameters,
      options,
      canCancel: true,
    });

    // Execute in background
    this.executeDetachedTask(executionId).catch(error => {
      console.error(`Detached execution ${executionId} failed:`, error);
    });

    return {
      executionId,
      status: 'pending',
      canCancel: true,
    };
  }

  /**
   * Get execution status
   */
  getExecutionStatus(executionId: string): any | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Cancel a detached execution
   */
  cancelExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || !execution.canCancel) {
      return false;
    }

    execution.status = 'cancelled';
    return true;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout(
    tool: Function,
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
   * Execute async task in background
   */
  private async executeAsyncTask(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    execution.status = 'running';

    try {
      const result = await execution.tool(execution.parameters);
      execution.status = 'completed';
      execution.result = result;
    } catch (error) {
      execution.status = 'failed';
      execution.error = (error as Error).message;
    }
  }

  /**
   * Execute streaming task in background
   */
  private async executeStreamingTask(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    execution.status = 'running';

    try {
      // Simulate streaming by calling the tool and emitting chunks
      const result = await execution.tool(execution.parameters);
      
      // If the tool returns an async iterator, stream it
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        for await (const chunk of result) {
          execution.chunks.push(chunk);
          if (execution.onChunk) {
            execution.onChunk(chunk);
          }
        }
      } else {
        // Single chunk result
        execution.chunks.push(result);
        if (execution.onChunk) {
          execution.onChunk(result);
        }
      }

      execution.status = 'completed';
      execution.result = result;
    } catch (error) {
      execution.status = 'failed';
      execution.error = (error as Error).message;
    }
  }

  /**
   * Execute detached task in background
   */
  private async executeDetachedTask(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    execution.status = 'running';

    try {
      const result = await execution.tool(execution.parameters);
      execution.status = 'completed';
      execution.result = result;
    } catch (error) {
      execution.status = 'failed';
      execution.error = (error as Error).message;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clear completed executions
   */
  clearCompleted(): void {
    for (const [id, execution] of this.executions.entries()) {
      if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
        this.executions.delete(id);
      }
    }
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    totalExecutions: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const executions = Array.from(this.executions.values());
    
    return {
      totalExecutions: executions.length,
      pending: executions.filter(e => e.status === 'pending').length,
      running: executions.filter(e => e.status === 'running').length,
      completed: executions.filter(e => e.status === 'completed').length,
      failed: executions.filter(e => e.status === 'failed').length,
      cancelled: executions.filter(e => e.status === 'cancelled').length,
    };
  }
}

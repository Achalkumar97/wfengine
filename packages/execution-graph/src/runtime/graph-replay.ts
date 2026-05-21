/**
 * Graph Replay - Phase 7 Task 3
 * 
 * Provides replay functionality for execution graphs.
 * This enables re-executing graph mutations from a specific point.
 */

import type { GraphSnapshot, GraphMutation } from './graph-mutation-semantics.js';

export interface ReplayOptions {
  fromMutationIndex?: number;
  toMutationIndex?: number;
  skipMutations?: string[];
  onlyMutations?: string[];
  dryRun?: boolean;
}

export interface ReplayResult {
  success: boolean;
  replayedMutations: number;
  skippedMutations: number;
  failedMutations: number;
  finalSnapshot: GraphSnapshot | null;
  errors: string[];
}

export class GraphReplay {
  /**
   * Replay mutations from a snapshot
   */
  replay(
    initialSnapshot: GraphSnapshot,
    mutations: GraphMutation[],
    options: ReplayOptions = {}
  ): ReplayResult {
    const result: ReplayResult = {
      success: true,
      replayedMutations: 0,
      skippedMutations: 0,
      failedMutations: 0,
      finalSnapshot: null,
      errors: [],
    };

    const startIndex = options.fromMutationIndex || 0;
    const endIndex = options.toMutationIndex !== undefined ? options.toMutationIndex : mutations.length;
    const skipTypes = options.skipMutations || [];
    const onlyTypes = options.onlyMutations || [];
    const dryRun = options.dryRun || false;

    // Filter mutations based on options
    let mutationsToReplay = mutations.slice(startIndex, endIndex);

    if (onlyTypes.length > 0) {
      mutationsToReplay = mutationsToReplay.filter(m => onlyTypes.includes(m.type));
    }

    mutationsToReplay = mutationsToReplay.filter(m => !skipTypes.includes(m.type));

    // If dry run, just count mutations
    if (dryRun) {
      result.replayedMutations = mutationsToReplay.length;
      result.finalSnapshot = initialSnapshot;
      return result;
    }

    // Replay mutations
    let currentSnapshot = initialSnapshot;

    for (const mutation of mutationsToReplay) {
      try {
        const newSnapshot = this.applyMutation(currentSnapshot, mutation);
        currentSnapshot = newSnapshot;
        result.replayedMutations++;
      } catch (error) {
        result.failedMutations++;
        result.success = false;
        result.errors.push(`Failed to apply mutation ${mutation.type}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    result.finalSnapshot = currentSnapshot;
    return result;
  }

  /**
   * Apply a single mutation to a snapshot
   */
  private applyMutation(snapshot: GraphSnapshot, mutation: GraphMutation): GraphSnapshot {
    const newSnapshot = {
      nodes: [...snapshot.nodes],
      edges: [...snapshot.edges],
      mutations: [...snapshot.mutations, mutation],
      timestamp: new Date(),
    };

    switch (mutation.type) {
      case 'add_node':
        if (!newSnapshot.nodes.find(n => n.id === mutation.data.id)) {
          newSnapshot.nodes.push(mutation.data);
        }
        break;

      case 'remove_node':
        newSnapshot.nodes = newSnapshot.nodes.filter(n => n.id !== mutation.data.nodeId);
        newSnapshot.edges = newSnapshot.edges.filter(e => e.from !== mutation.data.nodeId && e.to !== mutation.data.nodeId);
        break;

      case 'update_node':
        newSnapshot.nodes = newSnapshot.nodes.map(n =>
          n.id === mutation.data.nodeId ? { ...n, ...mutation.data.updates } : n
        );
        break;

      case 'add_edge':
        if (!newSnapshot.edges.find(e => e.from === mutation.data.from && e.to === mutation.data.to)) {
          newSnapshot.edges.push(mutation.data);
        }
        break;

      case 'remove_edge':
        newSnapshot.edges = newSnapshot.edges.filter(e => e.from !== mutation.data.from || e.to !== mutation.data.to);
        break;

      case 'update_edge':
        newSnapshot.edges = newSnapshot.edges.map(e =>
          e.from === mutation.data.from && e.to === mutation.data.to ? { ...e, ...mutation.data.updates } : e
        );
        break;

      default:
        throw new Error(`Unknown mutation type: ${mutation.type}`);
    }

    return newSnapshot;
  }

  /**
   * Replay a specific mutation
   */
  replaySingleMutation(
    snapshot: GraphSnapshot,
    mutation: GraphMutation
  ): GraphSnapshot {
    return this.applyMutation(snapshot, mutation);
  }

  /**
   * Validate replay before execution
   */
  validateReplay(
    initialSnapshot: GraphSnapshot,
    mutations: GraphMutation[],
    options: ReplayOptions = {}
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const startIndex = options.fromMutationIndex || 0;
    const endIndex = options.toMutationIndex !== undefined ? options.toMutationIndex : mutations.length;

    if (startIndex < 0 || startIndex > mutations.length) {
      errors.push(`Invalid start index: ${startIndex}`);
    }

    if (endIndex < 0 || endIndex > mutations.length) {
      errors.push(`Invalid end index: ${endIndex}`);
    }

    if (startIndex > endIndex) {
      errors.push(`Start index (${startIndex}) cannot be greater than end index (${endIndex})`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get mutation statistics
   */
  getMutationStats(mutations: GraphMutation[]): {
    totalMutations: number;
    mutationsByType: Record<string, number>;
  } {
    const mutationsByType: Record<string, number> = {};

    for (const mutation of mutations) {
      mutationsByType[mutation.type] = (mutationsByType[mutation.type] || 0) + 1;
    }

    return {
      totalMutations: mutations.length,
      mutationsByType,
    };
  }
}

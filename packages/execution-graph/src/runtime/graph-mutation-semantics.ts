/**
 * Graph Mutation Semantics - Phase 7 Task 1
 * 
 * Defines how execution graphs can be mutated during workflow execution.
 * This provides controlled graph mutation with validation and rollback support.
 */

export interface GraphNode {
  id: string;
  type: string;
  config: any;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
}

export interface GraphEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface GraphMutation {
  type: 'add_node' | 'remove_node' | 'add_edge' | 'remove_edge' | 'update_node' | 'update_edge';
  timestamp: Date;
  data: any;
  reason: string;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mutations: GraphMutation[];
  timestamp: Date;
}

export class GraphMutationSemantics {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private mutations: GraphMutation[] = [];
  private snapshots: GraphSnapshot[] = [];

  /**
   * Add a node to the graph
   */
  addNode(node: GraphNode, reason: string = 'Node added'): boolean {
    if (this.nodes.has(node.id)) {
      return false;
    }

    this.nodes.set(node.id, node);
    this.recordMutation({
      type: 'add_node',
      timestamp: new Date(),
      data: node,
      reason,
    });

    return true;
  }

  /**
   * Remove a node from the graph
   */
  removeNode(nodeId: string, reason: string = 'Node removed'): boolean {
    if (!this.nodes.has(nodeId)) {
      return false;
    }

    const node = this.nodes.get(nodeId)!;
    this.nodes.delete(nodeId);

    // Remove all edges connected to this node
    this.edges = this.edges.filter(edge => edge.from !== nodeId && edge.to !== nodeId);

    this.recordMutation({
      type: 'remove_node',
      timestamp: new Date(),
      data: { nodeId, node },
      reason,
    });

    return true;
  }

  /**
   * Update a node in the graph
   */
  updateNode(nodeId: string, updates: Partial<GraphNode>, reason: string = 'Node updated'): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return false;
    }

    const oldNode = { ...node };
    Object.assign(node, updates);

    this.recordMutation({
      type: 'update_node',
      timestamp: new Date(),
      data: { nodeId, oldNode, updates },
      reason,
    });

    return true;
  }

  /**
   * Add an edge to the graph
   */
  addEdge(edge: GraphEdge, reason: string = 'Edge added'): boolean {
    // Check if edge already exists
    const exists = this.edges.some(
      e => e.from === edge.from && e.to === edge.to
    );

    if (exists) {
      return false;
    }

    // Check if nodes exist
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      return false;
    }

    this.edges.push(edge);
    this.recordMutation({
      type: 'add_edge',
      timestamp: new Date(),
      data: edge,
      reason,
    });

    return true;
  }

  /**
   * Remove an edge from the graph
   */
  removeEdge(from: string, to: string, reason: string = 'Edge removed'): boolean {
    const index = this.edges.findIndex(
      e => e.from === from && e.to === to
    );

    if (index === -1) {
      return false;
    }

    const edge = this.edges[index];
    this.edges.splice(index, 1);

    this.recordMutation({
      type: 'remove_edge',
      timestamp: new Date(),
      data: { from, to, edge },
      reason,
    });

    return true;
  }

  /**
   * Update an edge in the graph
   */
  updateEdge(from: string, to: string, updates: Partial<GraphEdge>, reason: string = 'Edge updated'): boolean {
    const index = this.edges.findIndex(
      e => e.from === from && e.to === to
    );

    if (index === -1) {
      return false;
    }

    const oldEdge = { ...this.edges[index] };
    Object.assign(this.edges[index], updates);

    this.recordMutation({
      type: 'update_edge',
      timestamp: new Date(),
      data: { from, to, oldEdge, updates },
      reason,
    });

    return true;
  }

  /**
   * Record a mutation
   */
  private recordMutation(mutation: GraphMutation): void {
    this.mutations.push(mutation);
  }

  /**
   * Create a snapshot of the current graph state
   */
  createSnapshot(): GraphSnapshot {
    const snapshot: GraphSnapshot = {
      nodes: Array.from(this.nodes.values()),
      edges: [...this.edges],
      mutations: [...this.mutations],
      timestamp: new Date(),
    };

    this.snapshots.push(snapshot);

    // Keep only last 10 snapshots
    if (this.snapshots.length > 10) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * Restore graph from a snapshot
   */
  restoreSnapshot(snapshot: GraphSnapshot): boolean {
    this.nodes.clear();
    this.edges = [];
    this.mutations = [];

    for (const node of snapshot.nodes) {
      this.nodes.set(node.id, node);
    }

    this.edges = [...snapshot.edges];
    this.mutations = [...snapshot.mutations];

    return true;
  }

  /**
   * Get the latest snapshot
   */
  getLatestSnapshot(): GraphSnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /**
   * Get all snapshots
   */
  getSnapshots(): GraphSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get all nodes
   */
  getNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get a specific node
   */
  getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get all edges
   */
  getEdges(): GraphEdge[] {
    return [...this.edges];
  }

  /**
   * Get all mutations
   */
  getMutations(): GraphMutation[] {
    return [...this.mutations];
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.mutations = [];
    this.snapshots = [];
  }

  /**
   * Validate the graph for cycles
   */
  detectCycle(): string[] | null {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const outgoingEdges = this.edges.filter(e => e.from === nodeId);
      
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.to)) {
          if (dfs(edge.to)) {
            return true;
          }
        } else if (recursionStack.has(edge.to)) {
          return true;
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) {
          return path;
        }
      }
    }

    return null;
  }

  /**
   * Validate the graph
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for cycles
    const cycle = this.detectCycle();
    if (cycle) {
      errors.push(`Cycle detected: ${cycle.join(' -> ')}`);
    }

    // Check for orphaned nodes (no incoming or outgoing edges)
    for (const [nodeId] of this.nodes.entries()) {
      const hasIncoming = this.edges.some(e => e.to === nodeId);
      const hasOutgoing = this.edges.some(e => e.from === nodeId);

      if (!hasIncoming && !hasOutgoing) {
        errors.push(`Orphaned node: ${nodeId}`);
      }
    }

    // Check for edges to non-existent nodes
    for (const edge of this.edges) {
      if (!this.nodes.has(edge.from)) {
        errors.push(`Edge from non-existent node: ${edge.from}`);
      }
      if (!this.nodes.has(edge.to)) {
        errors.push(`Edge to non-existent node: ${edge.to}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    totalNodes: number;
    totalEdges: number;
    totalMutations: number;
    totalSnapshots: number;
    nodesByStatus: Record<string, number>;
  } {
    const nodesByStatus: Record<string, number> = {};

    for (const node of this.nodes.values()) {
      nodesByStatus[node.status] = (nodesByStatus[node.status] || 0) + 1;
    }

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
      totalMutations: this.mutations.length,
      totalSnapshots: this.snapshots.length,
      nodesByStatus,
    };
  }
}

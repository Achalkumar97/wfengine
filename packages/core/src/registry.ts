import type { NodeDefinition } from "./node.types.js";
import { UnknownNodeTypeError } from "./errors.js";

/** In-memory registry of node definitions keyed by `type` */
export class NodeRegistry {
  private readonly types = new Map<string, NodeDefinition>();

  register(def: NodeDefinition): void {
    if (this.types.has(def.type)) {
      throw new Error(`Node type already registered: ${def.type}`);
    }
    this.types.set(def.type, def);
  }

  /** Replace if exists (used when reloading plugins) */
  registerOrReplace(def: NodeDefinition): void {
    this.types.set(def.type, def);
  }

  get(type: string): NodeDefinition | undefined {
    return this.types.get(type);
  }

  require(type: string, nodeId?: string): NodeDefinition {
    const def = this.types.get(type);
    if (!def) throw new UnknownNodeTypeError(type, nodeId);
    return def;
  }

  list(): NodeDefinition[] {
    return [...this.types.values()];
  }
}

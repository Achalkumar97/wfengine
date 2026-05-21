/**
 * Capability Registry - Phase 8 Task 1
 * 
 * Provides a registry for agent and tool capabilities.
 * This enables discovery and matching of capabilities to tasks.
 */

export interface Capability {
  id: string;
  name: string;
  type: 'agent' | 'tool' | 'provider';
  description: string;
  version: string;
  metadata?: Record<string, any>;
}

export interface CapabilityRegistration {
  capability: Capability;
  ownerId: string;
  registeredAt: Date;
  expiresAt?: Date;
}

export class CapabilityRegistry {
  private capabilities: Map<string, CapabilityRegistration> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map(); // type -> capability IDs

  /**
   * Register a capability
   */
  register(capability: Capability, ownerId: string, expiresAt?: Date): boolean {
    if (this.capabilities.has(capability.id)) {
      return false;
    }

    const registration: CapabilityRegistration = {
      capability,
      ownerId,
      registeredAt: new Date(),
      expiresAt,
    };

    this.capabilities.set(capability.id, registration);

    // Update index
    if (!this.capabilityIndex.has(capability.type)) {
      this.capabilityIndex.set(capability.type, new Set());
    }
    this.capabilityIndex.get(capability.type)!.add(capability.id);

    return true;
  }

  /**
   * Unregister a capability
   */
  unregister(capabilityId: string): boolean {
    const registration = this.capabilities.get(capabilityId);
    if (!registration) {
      return false;
    }

    // Update index
    this.capabilityIndex.get(registration.capability.type)?.delete(capabilityId);

    return this.capabilities.delete(capabilityId);
  }

  /**
   * Get a capability by ID
   */
  get(capabilityId: string): Capability | undefined {
    const registration = this.capabilities.get(capabilityId);
    
    if (!registration) {
      return undefined;
    }

    // Check if expired
    if (registration.expiresAt && registration.expiresAt < new Date()) {
      this.unregister(capabilityId);
      return undefined;
    }

    return registration.capability;
  }

  /**
   * Get all capabilities
   */
  getAll(): Capability[] {
    const capabilities: Capability[] = [];

    for (const registration of this.capabilities.values()) {
      // Skip expired
      if (registration.expiresAt && registration.expiresAt < new Date()) {
        continue;
      }
      capabilities.push(registration.capability);
    }

    return capabilities;
  }

  /**
   * Get capabilities by type
   */
  getByType(type: 'agent' | 'tool' | 'provider'): Capability[] {
    const capabilityIds = this.capabilityIndex.get(type);
    if (!capabilityIds) {
      return [];
    }

    const capabilities: Capability[] = [];

    for (const id of capabilityIds) {
      const capability = this.get(id);
      if (capability) {
        capabilities.push(capability);
      }
    }

    return capabilities;
  }

  /**
   * Get capabilities by owner
   */
  getByOwner(ownerId: string): Capability[] {
    const capabilities: Capability[] = [];

    for (const registration of this.capabilities.values()) {
      if (registration.ownerId === ownerId) {
        // Skip expired
        if (registration.expiresAt && registration.expiresAt < new Date()) {
          continue;
        }
        capabilities.push(registration.capability);
      }
    }

    return capabilities;
  }

  /**
   * Search capabilities by name (partial match)
   */
  searchByName(query: string): Capability[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(capability =>
      capability.name.toLowerCase().includes(lowerQuery) ||
      capability.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Search capabilities by metadata
   */
  searchByMetadata(key: string, value: any): Capability[] {
    return this.getAll().filter(capability =>
      capability.metadata && capability.metadata[key] === value
    );
  }

  /**
   * Check if a capability exists
   */
  has(capabilityId: string): boolean {
    return this.get(capabilityId) !== undefined;
  }

  /**
   * Update a capability
   */
  update(capabilityId: string, updates: Partial<Capability>): boolean {
    const registration = this.capabilities.get(capabilityId);
    if (!registration) {
      return false;
    }

    Object.assign(registration.capability, updates);
    return true;
  }

  /**
   * Clear all capabilities
   */
  clear(): void {
    this.capabilities.clear();
    this.capabilityIndex.clear();
  }

  /**
   * Clear expired capabilities
   */
  clearExpired(): number {
    let count = 0;
    const now = new Date();

    for (const [id, registration] of this.capabilities.entries()) {
      if (registration.expiresAt && registration.expiresAt < now) {
        this.unregister(id);
        count++;
      }
    }

    return count;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalCapabilities: number;
    capabilitiesByType: Record<string, number>;
    capabilitiesByOwner: Record<string, number>;
    expiredCapabilities: number;
  } {
    const capabilitiesByType: Record<string, number> = {};
    const capabilitiesByOwner: Record<string, number> = {};
    let expiredCount = 0;

    for (const registration of this.capabilities.values()) {
      // Count by type
      capabilitiesByType[registration.capability.type] =
        (capabilitiesByType[registration.capability.type] || 0) + 1;

      // Count by owner
      capabilitiesByOwner[registration.ownerId] =
        (capabilitiesByOwner[registration.ownerId] || 0) + 1;

      // Count expired
      if (registration.expiresAt && registration.expiresAt < new Date()) {
        expiredCount++;
      }
    }

    return {
      totalCapabilities: this.capabilities.size,
      capabilitiesByType,
      capabilitiesByOwner,
      expiredCapabilities: expiredCount,
    };
  }
}

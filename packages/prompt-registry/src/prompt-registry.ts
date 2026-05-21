/**
 * Prompt Registry - Phase 9 Task 1
 * 
 * Provides a registry for prompt templates and artifacts.
 * This enables versioned prompt management and retrieval.
 */

export interface PromptTemplate {
  id: string;
  name: string;
  template: string;
  version: string;
  description: string;
  parameters: string[];
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class PromptRegistry {
  private prompts: Map<string, PromptTemplate> = new Map();
  private versionIndex: Map<string, Map<string, string>> = new Map(); // name -> version -> id

  /**
   * Register a prompt template
   */
  register(prompt: PromptTemplate): boolean {
    if (this.prompts.has(prompt.id)) {
      return false;
    }

    this.prompts.set(prompt.id, prompt);

    // Update version index
    if (!this.versionIndex.has(prompt.name)) {
      this.versionIndex.set(prompt.name, new Map());
    }
    this.versionIndex.get(prompt.name)!.set(prompt.version, prompt.id);

    return true;
  }

  /**
   * Unregister a prompt template
   */
  unregister(promptId: string): boolean {
    const prompt = this.prompts.get(promptId);
    if (!prompt) {
      return false;
    }

    // Update version index
    this.versionIndex.get(prompt.name)?.delete(prompt.version);

    return this.prompts.delete(promptId);
  }

  /**
   * Get a prompt by ID
   */
  get(promptId: string): PromptTemplate | undefined {
    return this.prompts.get(promptId);
  }

  /**
   * Get a prompt by name and version
   */
  getByNameAndVersion(name: string, version: string): PromptTemplate | undefined {
    const versionMap = this.versionIndex.get(name);
    if (!versionMap) {
      return undefined;
    }

    const promptId = versionMap.get(version);
    if (!promptId) {
      return undefined;
    }

    return this.prompts.get(promptId);
  }

  /**
   * Get the latest version of a prompt by name
   */
  getLatestByName(name: string): PromptTemplate | undefined {
    const versionMap = this.versionIndex.get(name);
    if (!versionMap || versionMap.size === 0) {
      return undefined;
    }

    // Get the latest version (assuming semantic versioning)
    const versions = Array.from(versionMap.keys()).sort().reverse();
    const latestVersion = versions[0];
    const promptId = versionMap.get(latestVersion);

    return promptId ? this.prompts.get(promptId) : undefined;
  }

  /**
   * Get all prompts
   */
  getAll(): PromptTemplate[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Get prompts by tag
   */
  getByTag(tag: string): PromptTemplate[] {
    return this.getAll().filter(prompt => prompt.tags.includes(tag));
  }

  /**
   * Search prompts by name or description
   */
  search(query: string): PromptTemplate[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(prompt =>
      prompt.name.toLowerCase().includes(lowerQuery) ||
      prompt.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get all versions of a prompt by name
   */
  getVersionsByName(name: string): PromptTemplate[] {
    const versionMap = this.versionIndex.get(name);
    if (!versionMap) {
      return [];
    }

    const prompts: PromptTemplate[] = [];
    for (const promptId of versionMap.values()) {
      const prompt = this.prompts.get(promptId);
      if (prompt) {
        prompts.push(prompt);
      }
    }

    return prompts.sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Update a prompt
   */
  update(promptId: string, updates: Partial<PromptTemplate>): boolean {
    const prompt = this.prompts.get(promptId);
    if (!prompt) {
      return false;
    }

    Object.assign(prompt, updates);
    prompt.updatedAt = new Date();

    return true;
  }

  /**
   * Clear all prompts
   */
  clear(): void {
    this.prompts.clear();
    this.versionIndex.clear();
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalPrompts: number;
    totalNames: number;
    promptsByTag: Record<string, number>;
    averageVersionsPerName: number;
  } {
    const promptsByTag: Record<string, number> = {};

    for (const prompt of this.prompts.values()) {
      for (const tag of prompt.tags) {
        promptsByTag[tag] = (promptsByTag[tag] || 0) + 1;
      }
    }

    const totalVersions = Array.from(this.versionIndex.values()).reduce(
      (sum, versionMap) => sum + versionMap.size,
      0
    );

    return {
      totalPrompts: this.prompts.size,
      totalNames: this.versionIndex.size,
      promptsByTag,
      averageVersionsPerName: this.versionIndex.size > 0 ? totalVersions / this.versionIndex.size : 0,
    };
  }
}

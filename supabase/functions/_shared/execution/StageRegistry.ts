/**
 * StageRegistry
 *
 * Central registry for all stage definitions.
 * Stages are registered by pipeline and stage ID.
 *
 * Usage:
 * - Register stage: StageRegistry.register('instagram_carousel', captionStage)
 * - Get stage: StageRegistry.get('instagram_carousel', 'caption')
 * - Get all stages for pipeline: StageRegistry.getAll('instagram_carousel')
 */

import type { StageDefinition, PipelineType } from './types.ts';

class StageRegistryClass {
  /**
   * Map of pipeline -> stageId -> StageDefinition
   */
  private stages: Map<string, Map<string, StageDefinition>> = new Map();

  /**
   * Default stages that apply to all pipelines.
   */
  private defaultStages: Map<string, StageDefinition> = new Map();

  /**
   * Register a stage definition for a specific pipeline.
   *
   * @param pipeline The pipeline this stage belongs to
   * @param stage The stage definition
   */
  register(pipeline: PipelineType | 'default', stage: StageDefinition): void {
    if (pipeline === 'default') {
      this.defaultStages.set(stage.id, stage);
      console.log(`[StageRegistry] Registered default stage: ${stage.id}`);
      return;
    }

    if (!this.stages.has(pipeline)) {
      this.stages.set(pipeline, new Map());
    }

    this.stages.get(pipeline)!.set(stage.id, stage);
    console.log(`[StageRegistry] Registered stage: ${pipeline}:${stage.id}`);
  }

  /**
   * Register multiple stages for a pipeline.
   */
  registerAll(pipeline: PipelineType | 'default', stages: StageDefinition[]): void {
    for (const stage of stages) {
      this.register(pipeline, stage);
    }
  }

  /**
   * Get a stage definition.
   *
   * Looks up in order:
   * 1. Pipeline-specific stage
   * 2. Default stage
   *
   * @param pipeline The pipeline to look in
   * @param stageId The stage ID to find
   * @returns The stage definition or null if not found
   */
  get(pipeline: PipelineType, stageId: string): StageDefinition | null {
    // Check pipeline-specific first
    const pipelineStages = this.stages.get(pipeline);
    if (pipelineStages?.has(stageId)) {
      return pipelineStages.get(stageId)!;
    }

    // Fall back to default
    if (this.defaultStages.has(stageId)) {
      return this.defaultStages.get(stageId)!;
    }

    console.warn(`[StageRegistry] Stage not found: ${pipeline}:${stageId}`);
    return null;
  }

  /**
   * Get all stages for a pipeline (including applicable defaults).
   */
  getAll(pipeline: PipelineType): StageDefinition[] {
    const stages: StageDefinition[] = [];

    // Add pipeline-specific stages
    const pipelineStages = this.stages.get(pipeline);
    if (pipelineStages) {
      stages.push(...pipelineStages.values());
    }

    // Add default stages that aren't overridden
    for (const [stageId, stage] of this.defaultStages) {
      if (!pipelineStages?.has(stageId)) {
        stages.push(stage);
      }
    }

    return stages;
  }

  /**
   * Check if a stage exists for a pipeline.
   */
  has(pipeline: PipelineType, stageId: string): boolean {
    return this.get(pipeline, stageId) !== null;
  }

  /**
   * Get all registered pipelines.
   */
  getPipelines(): string[] {
    return Array.from(this.stages.keys());
  }

  /**
   * Get stage IDs for a pipeline.
   */
  getStageIds(pipeline: PipelineType): string[] {
    const stages = new Set<string>();

    // Pipeline-specific
    const pipelineStages = this.stages.get(pipeline);
    if (pipelineStages) {
      for (const stageId of pipelineStages.keys()) {
        stages.add(stageId);
      }
    }

    // Defaults
    for (const stageId of this.defaultStages.keys()) {
      stages.add(stageId);
    }

    return Array.from(stages);
  }

  /**
   * Clear all registered stages (mainly for testing).
   */
  clear(): void {
    this.stages.clear();
    this.defaultStages.clear();
  }

  /**
   * Get debug information about the registry.
   */
  getDebugInfo(): {
    pipelines: string[];
    defaultStages: string[];
    stagesByPipeline: Record<string, string[]>;
  } {
    const stagesByPipeline: Record<string, string[]> = {};

    for (const [pipeline, stages] of this.stages) {
      stagesByPipeline[pipeline] = Array.from(stages.keys());
    }

    return {
      pipelines: Array.from(this.stages.keys()),
      defaultStages: Array.from(this.defaultStages.keys()),
      stagesByPipeline,
    };
  }
}

// Export singleton instance
export const StageRegistry = new StageRegistryClass();

/**
 * Helper to create a stage definition with type checking.
 */
export function defineStage(stage: StageDefinition): StageDefinition {
  // Validate required fields
  if (!stage.id) {
    throw new Error('Stage definition must have an id');
  }
  if (!stage.type) {
    throw new Error(`Stage ${stage.id} must have a type`);
  }
  if (!stage.provider) {
    throw new Error(`Stage ${stage.id} must have a provider`);
  }

  return stage;
}

/**
 * Decorator-style function to register a stage.
 */
export function registerStage(pipeline: PipelineType | 'default') {
  return (stage: StageDefinition): StageDefinition => {
    StageRegistry.register(pipeline, stage);
    return stage;
  };
}

export default StageRegistry;

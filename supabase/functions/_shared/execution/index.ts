/**
 * Execution Module Index
 *
 * Exports all execution-related classes and functions.
 */

// Types
export * from './types.ts';

// Context
export {
  buildExecutionContext,
  extractBrandVoice,
  extractCharacter,
  extractProduct,
  extractCreator,
  extractICP,
  extractSearchTerm,
  extractAllReferenceImages,
  buildVisualStyle,
  extractModelConfig,
  extractIdeaContext,
  getContextValue,
  validateContextRequirements,
} from './ExecutionContext.ts';
export type { BuildContextOptions } from './ExecutionContext.ts';

// Registry
export { StageRegistry, defineStage, registerStage } from './StageRegistry.ts';

// Engine
export {
  ExecutionEngine,
  createExecutionEngine,
  registerCustomHandler,
} from './ExecutionEngine.ts';

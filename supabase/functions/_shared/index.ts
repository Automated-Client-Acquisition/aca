/**
 * Shared Module Index
 *
 * Central exports for the unified pipeline execution engine.
 */

// Execution engine and context
export * from './execution/index.ts';

// Providers
export * from './providers/index.ts';

// Builders
export * from './builders/PromptBuilder.ts';

// Stage definitions are auto-registered on import
// Import them to register:
// import '../_shared/stages/definitions/index.ts';

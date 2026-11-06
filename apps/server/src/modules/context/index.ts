// The context module's public API (ARCH-020): prompts built at a read point, from
// templates in six layers, within each model's budget (09-context). It imports only
// content, memory, and storage (ARCH-021, CTX-110).
export { type ContextBuilderOptions, createContextBuilder } from './builder';
export type { Built, BuiltPrompt, ContextBuilder, ContextDependencies, KeySpeaker } from './types';

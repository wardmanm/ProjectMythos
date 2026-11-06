// The providers module's public API (ARCH-020): the adapter interface, the adapter
// registry, the mock adapter, token estimation with calibration, the job queue, and the
// model calls every module makes: the structured-output pipeline and streamed text.
export type {
  ProviderAdapter,
  ProviderError,
  ResponseFormat,
  TextRequest,
  TextResponse,
} from './types';
export { type AdapterDependencies, createAdapter } from './registry';
export { createMockAdapter, type MockAdapter, type MockProviderConfig } from './mock-adapter';
export { type MockOutcome, mockProviderError, mockResponse } from './mock-outputs';
export { CALIBRATION_FILE, type Calibration, estimateTokens, openCalibration } from './tokens';
// The job queue (05-providers §6).
export {
  createJobQueue,
  type EnqueueOptions,
  type InteractiveOptions,
  type JobContext,
  type JobHandler,
  type JobQueue,
  type JobQueueLifecycle,
  type JobQueueOptions,
  type QueueLogger,
  type SetTimer,
} from './queue';
// The model calls (05-providers §4, §5), and the routing and schema adaptation they use,
// which the context module (CTX-110) and the probe (PRV-092) use too.
export {
  type CallStructured,
  createModelCalls,
  type ModelCalls,
  type PromptReport,
  type StreamedText,
  type StreamText,
  type StreamTextOptions,
  type StructuredCallOptions,
} from './structured';
export type { ModelCallsOptions } from './model-call';
export { type RoleRoute, routeRole } from './role-routing';
export { adaptSchema, type JsonSchema, toJsonSchema } from './schema-adapt';
// Settings support (05-providers §9): each provider's status.
export {
  createHealthCheck,
  HEALTH_TIMEOUT_MS,
  type HealthCheck,
  type HealthCheckOptions,
  type ProviderStatus,
} from './health';

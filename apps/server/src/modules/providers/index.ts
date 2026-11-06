// The providers module's public API (ARCH-020): the adapter interface, the adapter
// registry, the mock adapter, and token estimation with calibration.
export type {
  ProviderAdapter,
  ProviderError,
  ResponseFormat,
  TextRequest,
  TextResponse,
} from './types';
export { createAdapter } from './registry';
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

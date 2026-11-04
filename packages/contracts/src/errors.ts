import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'validation_failed', // request or data failed schema validation
  'not_found',
  'conflict', // e.g. stale branch head
  'turn_in_progress', // ARCH-070
  'illegal_state_change', // semantic validation rejected a commit
  'model_output_invalid', // structured output failed after retries
  'provider_unavailable',
  'provider_timeout',
  'provider_rejected', // provider refused the request: 4xx, schema too complex, content refusal
  'context_overflow', // fixed prompt tiers exceed the model's budget (CTX-032)
  'not_configured', // a model role this call needs has no assignment (PRV-001)
  'cancelled',
  'auth_required',
  'auth_failed',
  'rate_limited',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const AppErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type AppError = z.infer<typeof AppErrorSchema>;

/** HTTP error body (ARCH-101). */
export const ErrorResponseSchema = z.object({ error: AppErrorSchema });

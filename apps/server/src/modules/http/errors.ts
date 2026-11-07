// The HTTP side of errors: one table from error code to status (ARCH-104), the error body
// (ARCH-101), request parsing that lists every issue at a dotted path (CON-091), and the
// one handler for anything a route throws (CONV-041).
import {
  type AppError,
  type ErrorCode,
  err,
  ok,
  type Result,
  type SemanticIssue,
} from '@mythos/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

/** Every error code's HTTP status, in one table. Implements ARCH-104. */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 400,
  auth_required: 401,
  auth_failed: 401,
  not_found: 404,
  conflict: 409,
  turn_in_progress: 409,
  cancelled: 409,
  illegal_state_change: 422,
  context_overflow: 422,
  rate_limited: 429,
  internal_error: 500,
  model_output_invalid: 502,
  provider_rejected: 502,
  provider_unavailable: 503,
  not_configured: 503,
  provider_timeout: 504,
};

const INTERNAL_ERROR: AppError = {
  code: 'internal_error',
  message: 'Something went wrong on the server. Its log has the details.',
};

const RetryAfterSchema = z.object({ retryAfterSeconds: z.number().nonnegative() });

/**
 * Replies with an error's status and its `{ error: { code, message, details? } }` body.
 * Only those three fields are sent, so a `ProviderError`'s `retryable` and `httpStatus`
 * stay on the server. A `rate_limited` error's wait also goes in `Retry-After`
 * (03-contracts Decisions). Implements ARCH-101.
 */
export function sendError(reply: FastifyReply, error: AppError): FastifyReply {
  const { code, message, details } = error;
  if (code === 'rate_limited') {
    const wait = RetryAfterSchema.safeParse(details);
    if (wait.success) reply.header('retry-after', String(Math.ceil(wait.data.retryAfterSeconds)));
  }
  const body: AppError = details === undefined ? { code, message } : { code, message, details };
  return reply.code(STATUS_BY_CODE[code]).send({ error: body });
}

/** The `validation_failed` error for a request's issues. Implements CON-091. */
export function validationFailed(issues: SemanticIssue[]): AppError {
  return {
    code: 'validation_failed',
    message: 'Some of what was sent is not valid.',
    details: { issues },
  };
}

/** Zod's issues as CON-091's: each at a dotted path into the value, '' for all of it. */
export function issuesOf(error: z.ZodError): SemanticIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * A request body or query string parsed with its schema, or `validation_failed` listing
 * every issue at once (CON-091). Implements CONV-030.
 */
export function parseRequest<S extends z.ZodType>(
  schema: S,
  value: unknown,
): Result<z.output<S>, AppError> {
  const parsed = schema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(validationFailed(issuesOf(parsed.error)));
}

/**
 * A route's path parameters parsed with their schema. One that fails is `not_found`:
 * nothing can be at that address, and CON-091's paths point into the body, not the URL.
 */
export function parseParams<S extends z.ZodType>(
  schema: S,
  params: unknown,
  url: string,
): Result<z.output<S>, AppError> {
  const parsed = schema.safeParse(params);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: 'not_found', message: `Nothing is at ${url}.` });
}

/** Fastify's own refusal of a malformed request: bad JSON, a body too large, and so on. */
const RequestRefusalSchema = z.object({
  statusCode: z.int().min(400).max(499),
  message: z.string(),
});

/**
 * The one place a throw is caught (CONV-041). Fastify's refusals of a malformed request
 * are `validation_failed` with one issue for the whole body. Anything else is logged and
 * answered with `internal_error`, whose message never repeats the thrown one.
 * Implements CONV-041.
 */
export function installErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error, request, reply) => {
    const refusal = RequestRefusalSchema.safeParse(error);
    if (refusal.success) {
      return sendError(reply, validationFailed([{ path: '', message: refusal.data.message }]));
    }
    request.log.error({ err: error }, 'a request failed unexpectedly');
    return sendError(reply, INTERNAL_ERROR);
  });
}

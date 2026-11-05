import { AppErrorSchema, type ErrorCode } from '@mythos/contracts';
import { z } from 'zod';

/**
 * Why a request failed, as the client sees it (ARCH-122):
 * - `server`: the server answered with an error body (ARCH-101);
 * - `unreachable`: no answer, or an error answer that is not the server's own;
 * - `invalid-response`: a success answer whose body does not match its contract.
 */
export const ApiFailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('server'), status: z.int(), error: AppErrorSchema }),
  z.object({ kind: z.literal('unreachable'), detail: z.string() }),
  z.object({ kind: z.literal('invalid-response'), detail: z.string() }),
]);
export type ApiFailure = z.infer<typeof ApiFailureSchema>;

/**
 * The thrown form of a failure: a plain `Error` carrying it as its `cause`, since the
 * conventions allow no Error subclass (CONV-007, 02-conventions Decisions).
 */
export function apiError(failure: ApiFailure): Error {
  const summary = failure.kind === 'server' ? failure.error.code : failure.kind;
  return new Error(`API request failed: ${summary}`, { cause: failure });
}

/** The failure an `apiError` carries, or null for any other thrown value. */
export function apiFailureOf(thrown: unknown): ApiFailure | null {
  if (!(thrown instanceof Error)) return null;
  const parsed = ApiFailureSchema.safeParse(thrown.cause);
  return parsed.success ? parsed.data : null;
}

/** The error code of a server failure, or null for anything else. */
export function errorCodeOf(thrown: unknown): ErrorCode | null {
  const failure = apiFailureOf(thrown);
  return failure?.kind === 'server' ? failure.error.code : null;
}

// Implements ARCH-122: the one place the client calls fetch. Every answer is parsed at
// this boundary (CONV-030): a success body with its contract schema, an error body with
// ErrorResponseSchema. Paths are relative, under /api (ARCH-102).
import { ErrorResponseSchema } from '@mythos/contracts';
import { z } from 'zod';
import { apiError, type ApiFailure } from './api-failure';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON. */
  body?: unknown;
  /** From TanStack Query, so leaving a screen cancels its requests. */
  signal?: AbortSignal;
};

/** Sends a request and returns its body, parsed with `schema`. Throws an `apiError`. */
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(path, options);
  const body = await readJson(response);
  if (body === unreadable) {
    throw apiError({ kind: 'invalid-response', detail: `${path}: the body is not JSON` });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw apiError({
      kind: 'invalid-response',
      detail: `${path}: ${z.prettifyError(parsed.error)}`,
    });
  }
  return parsed.data;
}

/** Sends a request whose success answer has no body, such as a `204`. Throws an `apiError`. */
export async function requestNoContent(path: string, options: RequestOptions = {}): Promise<void> {
  await send(path, options);
}

/** Fetches `/api<path>`, and throws an `apiError` unless the answer is a success. */
async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (options.signal !== undefined) init.signal = options.signal;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch (thrown) {
    // A cancelled request is not a failure to report: let TanStack Query see the abort.
    if (options.signal?.aborted === true) throw thrown;
    throw apiError({ kind: 'unreachable', detail: `${path}: ${String(thrown)}` });
  }
  if (!response.ok) throw apiError(await failureOf(path, response));
  return response;
}

/** Reads an error answer. One that is not the server's error body means a proxy or a stranger answered. */
async function failureOf(path: string, response: Response): Promise<ApiFailure> {
  const parsed = ErrorResponseSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    return {
      kind: 'unreachable',
      detail: `${path}: ${String(response.status)} without an error body`,
    };
  }
  return { kind: 'server', status: response.status, error: parsed.data.error };
}

const unreadable = Symbol('unreadable');

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    // The body was not JSON; each caller says what that means for its answer.
    return unreadable;
  }
}

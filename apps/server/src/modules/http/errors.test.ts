import {
  AppErrorSchema,
  ErrorCodeSchema,
  ErrorResponseSchema,
  SemanticIssueSchema,
} from '@mythos/contracts';
import { fastify } from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installErrorHandler, parseRequest, sendError, STATUS_BY_CODE } from './errors';

/** ARCH-104's table as the spec writes it. */
const SPEC_TABLE: Record<number, string[]> = {
  400: ['validation_failed'],
  401: ['auth_required', 'auth_failed'],
  404: ['not_found'],
  409: ['conflict', 'turn_in_progress', 'cancelled'],
  422: ['illegal_state_change', 'context_overflow'],
  429: ['rate_limited'],
  500: ['internal_error'],
  502: ['model_output_invalid', 'provider_rejected'],
  503: ['provider_unavailable', 'not_configured'],
  504: ['provider_timeout'],
};

const IssuesSchema = z.object({ issues: z.array(SemanticIssueSchema) });

/** A server whose routes reply with the error they are given, or throw. */
function errorServer() {
  const lines: string[] = [];
  const server = fastify({
    logger: {
      stream: {
        write: (line: string) => {
          lines.push(line);
        },
      },
    },
  });
  installErrorHandler(server);
  // Loose, so a provider error's own fields reach sendError as they would in a route.
  server.post('/fail', (request, reply) =>
    sendError(reply, AppErrorSchema.loose().parse(request.body)),
  );
  server.get('/throw', () => {
    throw new Error('the secret reason');
  });
  server.post('/echo', (request) => request.body);
  return { server, lines };
}

describe('STATUS_BY_CODE', () => {
  it('ARCH-104: every error code maps to the status the spec table gives it', () => {
    const fromSpec = Object.entries(SPEC_TABLE).flatMap(([status, codes]) =>
      codes.map((code) => [code, Number(status)] as const),
    );
    expect(Object.fromEntries(fromSpec)).toEqual(STATUS_BY_CODE);
    expect(Object.keys(STATUS_BY_CODE).sort()).toEqual([...ErrorCodeSchema.options].sort());
  });
});

describe('sendError', () => {
  it('ARCH-101, ARCH-104: every code is sent with its status as { error: { code, message } }', async () => {
    const { server } = errorServer();
    for (const code of ErrorCodeSchema.options) {
      const response = await server.inject({
        method: 'POST',
        url: '/fail',
        payload: { code, message: `${code} happened` },
      });
      expect(response.statusCode).toBe(STATUS_BY_CODE[code]);
      expect(ErrorResponseSchema.strict().parse(response.json())).toEqual({
        error: { code, message: `${code} happened` },
      });
    }
  });

  it('ARCH-101: details are sent, and a provider error keeps its own fields on the server', async () => {
    const { server } = errorServer();
    const response = await server.inject({
      method: 'POST',
      url: '/fail',
      payload: {
        code: 'provider_unavailable',
        message: 'Ollama is not running.',
        details: { at: 'localhost' },
        retryable: true,
        httpStatus: null,
      },
    });
    expect(response.json()).toEqual({
      error: {
        code: 'provider_unavailable',
        message: 'Ollama is not running.',
        details: { at: 'localhost' },
      },
    });
  });

  it('ARCH-110: a rate_limited error sends its wait as Retry-After too, in whole seconds', async () => {
    const { server } = errorServer();
    const response = await server.inject({
      method: 'POST',
      url: '/fail',
      payload: { code: 'rate_limited', message: 'Wait.', details: { retryAfterSeconds: 299.2 } },
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('300');
  });
});

describe('parseRequest', () => {
  it('CON-091: every issue is listed at once, each at a dotted path into the body', () => {
    const schema = z.object({ name: z.string(), pc: z.object({ mode: z.literal('premade') }) });
    const parsed = parseRequest(schema, { pc: { mode: 'custom' } });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('validation_failed');
    const { issues } = IssuesSchema.parse(parsed.error.details);
    expect(issues.map((issue) => issue.path)).toEqual(['name', 'pc.mode']);
  });

  it('CON-091: a body that is not an object at all has one issue at the empty path', () => {
    const parsed = parseRequest(z.object({ name: z.string() }), 'text');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(IssuesSchema.parse(parsed.error.details).issues.map((issue) => issue.path)).toEqual([
      '',
    ]);
  });
});

describe('installErrorHandler', () => {
  it('CONV-041: a throw is logged once and answered with internal_error, never its own message', async () => {
    const { server, lines } = errorServer();
    const response = await server.inject({ method: 'GET', url: '/throw' });
    expect(response.statusCode).toBe(500);
    const body = ErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).not.toContain('secret');
    const errors = lines
      .map((line) =>
        z.object({ level: z.number(), msg: z.string() }).loose().parse(JSON.parse(line)),
      )
      .filter((line) => line.level === 50);
    expect(errors.map((line) => line.msg)).toEqual(['a request failed unexpectedly']);
  });

  it('CON-091: malformed JSON is validation_failed with one issue for the whole body', async () => {
    const { server } = errorServer();
    const response = await server.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(response.statusCode).toBe(400);
    const body = ErrorResponseSchema.parse(response.json());
    expect(body.error.code).toBe('validation_failed');
    expect(IssuesSchema.parse(body.error.details).issues.map((issue) => issue.path)).toEqual(['']);
  });
});

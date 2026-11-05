import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ModelRole,
  ModelProfileSchema,
  ModelRoleSchema,
  type Result,
} from '@mythos/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockAdapter, type MockProviderConfig } from './mock-adapter';
import { defaultOutcome, mockProviderError, mockResponse } from './mock-outputs';
import type { ProviderError, TextRequest } from './types';

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/fixtures/model',
);

const textProfile = ModelProfileSchema.parse({
  id: 'mock-text',
  providerId: 'mock',
  model: 'mock',
  kind: 'text',
  contextWindow: 8192,
  maxOutputTokens: 512,
  structuredOutput: 'json-schema',
});

const embeddingProfile = ModelProfileSchema.parse({
  ...textProfile,
  id: 'mock-embedding',
  kind: 'embedding',
  embeddingDimensions: 16,
});

function mockConfig(overrides: Partial<MockProviderConfig> = {}): MockProviderConfig {
  return { id: 'mock', type: 'mock', deviceId: 'this-computer', delayMs: 0, ...overrides };
}

function request(role: ModelRole, overrides: Partial<TextRequest> = {}): TextRequest {
  return {
    role,
    profile: textProfile,
    messages: [{ role: 'user', content: 'I push the door open.' }],
    format: { type: 'text' },
    maxOutputTokens: 256,
    sampling: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function valueOf<T>(result: Result<T, ProviderError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
}

function errorOf<T>(result: Result<T, ProviderError>): ProviderError {
  if (result.ok) throw new Error('expected an error, got ok');
  return result.error;
}

/** Whether a promise has settled, without waiting for it. */
function tracked<T>(promise: Promise<T>): { settled: () => boolean } {
  let settled = false;
  void promise.then(() => (settled = true));
  return { settled: () => settled };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('scripted mode', () => {
  it('PRV-080: scripted outcomes come back per role, in the order they were queued', async () => {
    const mock = createMockAdapter(mockConfig());
    mock.script(
      'narrator',
      { type: 'response', response: mockResponse('First.') },
      { type: 'response', response: mockResponse('Second.') },
    );
    mock.script('extractor', { type: 'response', response: mockResponse('{}') });

    expect(valueOf(await mock.text.generate(request('narrator'))).text).toBe('First.');
    expect(valueOf(await mock.text.generate(request('extractor'))).text).toBe('{}');
    expect(valueOf(await mock.text.generate(request('narrator'))).text).toBe('Second.');
    expect(mock.requests.map((req) => req.role)).toEqual(['narrator', 'extractor', 'narrator']);
  });

  it('PRV-080: a call with nothing left in its script throws, naming the role and the call', async () => {
    const mock = createMockAdapter(mockConfig());
    mock.script('narrator', { type: 'response', response: mockResponse('Only.') });
    await mock.text.generate(request('narrator'));

    await expect(mock.text.generate(request('narrator'))).rejects.toThrow('narrator call 2');
    await expect(mock.text.generate(request('extractor'))).rejects.toThrow('extractor call 1');
  });

  it('PRV-080: once scripted, the mock reads no fixtures', async () => {
    const mock = createMockAdapter(
      mockConfig({ fixturesDir: path.join(fixturesRoot, 'prv-081-replay') }),
    );
    mock.script('narrator', { type: 'response', response: mockResponse('Scripted.') });
    expect(valueOf(await mock.text.generate(request('narrator'))).text).toBe('Scripted.');
  });
});

describe('default mode', () => {
  it('PRV-083: every text role gets short placeholder text, the same on every run', async () => {
    const textRoles = ModelRoleSchema.options.filter((role) => role !== 'embedder');
    for (const role of textRoles) {
      const first = valueOf(await createMockAdapter(mockConfig()).text.generate(request(role)));
      const again = valueOf(await createMockAdapter(mockConfig()).text.generate(request(role)));
      expect(first.text.length, role).toBeGreaterThan(0);
      expect(first.text.length, role).toBeLessThanOrEqual(120);
      expect(first.finishReason).toBe('stop');
      expect(first.usage.inputTokens).toBeGreaterThan(0);
      expect(again).toEqual(first);
    }
  });

  it('PRV-083: placeholder text changes from one call of a role to the next', async () => {
    const mock = createMockAdapter(mockConfig());
    const first = valueOf(await mock.text.generate(request('narrator'))).text;
    const second = valueOf(await mock.text.generate(request('narrator'))).text;
    expect(second).not.toBe(first);
  });

  it('PRV-083: a known schema name returns its placeholder, and an unknown one is rejected', async () => {
    const json = (schemaName: string) =>
      request('adjudicator', { format: { type: 'json', schemaName, jsonSchema: {} } });
    const placeholders = new Map([['ruling', { kind: 'direct', outcome: 'success' }]]);
    const known = defaultOutcome(json('ruling'), 1, placeholders);
    expect(known.type === 'response' && JSON.parse(known.response.text)).toEqual({
      kind: 'direct',
      outcome: 'success',
    });

    const unknown = errorOf(await createMockAdapter(mockConfig()).text.generate(json('ruling')));
    expect(unknown.code).toBe('provider_rejected');
    expect(unknown.message).toContain('"ruling"');
  });

  it('PRV-083: the embedder gets the same unit vectors for the same inputs', async () => {
    const mock = createMockAdapter(mockConfig());
    const signal = new AbortController().signal;
    const vectors = valueOf(await mock.embedding.embed(embeddingProfile, ['a', 'b', 'a'], signal));
    expect(vectors.map((vector) => vector.length)).toEqual([16, 16, 16]);
    expect(Math.hypot(...(vectors[0] ?? []))).toBeCloseTo(1, 10);
    expect(vectors[2]).toEqual(vectors[0]);
    expect(vectors[1]).not.toEqual(vectors[0]);
  });

  it('PRV-083: delayMs pauses after each streamed word', async () => {
    vi.useFakeTimers();
    const mock = createMockAdapter(mockConfig({ delayMs: 100 }));
    mock.script('narrator', { type: 'response', response: mockResponse('one two three') });
    const deltas: string[] = [];
    const pending = mock.text.generate(request('narrator', { onDelta: (d) => deltas.push(d) }));
    const call = tracked(pending);

    await vi.advanceTimersByTimeAsync(0);
    expect(deltas).toEqual(['one ']);
    await vi.advanceTimersByTimeAsync(99);
    expect(deltas).toEqual(['one ']);
    await vi.advanceTimersByTimeAsync(1);
    expect(deltas).toEqual(['one ', 'two ']);
    await vi.advanceTimersByTimeAsync(100);
    expect(deltas).toEqual(['one ', 'two ', 'three']);
    await vi.advanceTimersByTimeAsync(99);
    expect(call.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(valueOf(await pending).text).toBe('one two three');
  });
});

describe('errors, latency, and streaming', () => {
  it.each([
    ['provider_unavailable', true, 503],
    ['provider_timeout', true, null],
    ['rate_limited', true, 429],
    ['provider_rejected', false, 400],
    ['cancelled', false, null],
  ] as const)('PRV-084: %s, retryable %s, HTTP status %s', async (code, retryable, httpStatus) => {
    const mock = createMockAdapter(mockConfig());
    mock.script('narrator', { type: 'error', error: mockProviderError(code) });
    const error = errorOf(await mock.text.generate(request('narrator')));
    expect(error).toMatchObject({ code, retryable, httpStatus });
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('PRV-084: a call that is not streamed answers after delayMs', async () => {
    vi.useFakeTimers();
    const mock = createMockAdapter(mockConfig({ delayMs: 250 }));
    const pending = mock.text.generate(request('narrator'));
    const call = tracked(pending);
    await vi.advanceTimersByTimeAsync(249);
    expect(call.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(call.settled()).toBe(true);
  });

  it('PRV-084: streamed deltas join to exactly the final text, and leave out the thinking', async () => {
    const text = '  Rain,\n\nthen   silence. ';
    const mock = createMockAdapter(mockConfig());
    mock.script('narrator', {
      type: 'response',
      response: mockResponse(text, { thinking: 'The guard is lying.' }),
    });
    const deltas: string[] = [];
    const result = await mock.text.generate(
      request('narrator', { onDelta: (d) => deltas.push(d) }),
    );
    expect(deltas).toEqual(['  ', 'Rain,\n\n', 'then   ', 'silence. ']);
    expect(deltas.join('')).toBe(text);
    expect(valueOf(result)).toMatchObject({ text, thinking: 'The guard is lying.' });
  });

  it('PRV-084: an error can follow partial streamed text', async () => {
    const mock = createMockAdapter(mockConfig());
    mock.script('narrator', {
      type: 'error',
      error: mockProviderError('provider_unavailable'),
      partialText: 'The door creaks',
    });
    const deltas: string[] = [];
    const result = await mock.text.generate(
      request('narrator', { onDelta: (d) => deltas.push(d) }),
    );
    expect(deltas.join('')).toBe('The door creaks');
    expect(errorOf(result).code).toBe('provider_unavailable');
  });

  it('PRV-084: an abort mid-stream returns the text so far, marked cancelled', async () => {
    vi.useFakeTimers();
    const mock = createMockAdapter(mockConfig({ delayMs: 100 }));
    mock.script('narrator', { type: 'response', response: mockResponse('one two three four') });
    const controller = new AbortController();
    const deltas: string[] = [];
    const pending = mock.text.generate(
      request('narrator', { signal: controller.signal, onDelta: (d) => deltas.push(d) }),
    );
    await vi.advanceTimersByTimeAsync(150);
    controller.abort();
    const result = valueOf(await pending);
    expect(deltas).toEqual(['one ', 'two ']);
    expect(result).toMatchObject({ text: 'one two ', finishReason: 'cancelled' });
  });

  it('PRV-084: an abort before any text returns the cancelled error', async () => {
    const mock = createMockAdapter(mockConfig());
    const controller = new AbortController();
    controller.abort();
    const deltas: string[] = [];
    const result = await mock.text.generate(
      request('narrator', { signal: controller.signal, onDelta: (d) => deltas.push(d) }),
    );
    expect(deltas).toEqual([]);
    expect(errorOf(result).code).toBe('cancelled');
  });
});

describe('the network', () => {
  it('CONV-113: the mock never calls fetch, in any mode', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const signal = new AbortController().signal;

    const byDefault = createMockAdapter(mockConfig());
    await byDefault.health(signal);
    await byDefault.listModels(signal);
    await byDefault.text.generate(request('narrator', { onDelta: () => undefined }));
    await byDefault.embedding.embed(embeddingProfile, ['a'], signal);

    const scripted = createMockAdapter(mockConfig());
    scripted.script('narrator', { type: 'response', response: mockResponse('Scripted.') });
    await scripted.text.generate(request('narrator'));

    const replaying = createMockAdapter(
      mockConfig({ fixturesDir: path.join(fixturesRoot, 'prv-081-replay') }),
    );
    await replaying.text.generate(request('narrator'));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

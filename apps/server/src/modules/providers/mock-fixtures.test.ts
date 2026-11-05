import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ModelRole, ModelProfileSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { fixtureFileName } from './mock-fixtures';
import { createAdapter } from './registry';
import type { ProviderAdapter, TextRequest } from './types';

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../test/fixtures/model',
);

const profile = ModelProfileSchema.parse({
  id: 'mock-text',
  providerId: 'mock',
  model: 'mock',
  kind: 'text',
  contextWindow: 8192,
  maxOutputTokens: 512,
  structuredOutput: 'json-schema',
});

/** A mock provider replaying one scenario, built through the registry as config builds it. */
function replaying(scope: string): ProviderAdapter {
  return createAdapter({
    id: 'mock',
    type: 'mock',
    deviceId: 'this-computer',
    fixturesDir: path.join(fixturesRoot, scope),
    delayMs: 0,
  });
}

function generate(adapter: ProviderAdapter, role: ModelRole) {
  const req: TextRequest = {
    role,
    profile,
    messages: [{ role: 'user', content: 'I walk down to the harbour.' }],
    format: { type: 'text' },
    maxOutputTokens: 256,
    sampling: {},
    signal: new AbortController().signal,
  };
  return adapter.text!.generate(req);
}

describe('fixture mode', () => {
  it('PRV-081: replays by scope, role, and per-role sequence, with roles interleaved', async () => {
    const adapter = replaying('prv-081-replay');
    const narration = await generate(adapter, 'narrator');
    const extraction = await generate(adapter, 'extractor');
    const nextNarration = await generate(adapter, 'narrator');

    expect(narration).toEqual({
      ok: true,
      value: {
        text: 'The harbour bell rings as you step onto the quay.',
        thinking: null,
        usage: { inputTokens: 412, outputTokens: 13, cachedInputTokens: null },
        finishReason: 'stop',
      },
    });
    expect(extraction.ok && extraction.value.text).toBe('{"observations":[]}');
    expect(nextNarration.ok && nextNarration.value).toMatchObject({
      text: 'The fishmonger looks up, then quickly away.',
      usage: { cachedInputTokens: 380 },
    });
  });

  it('PRV-081: a call with no recorded fixture throws, naming the file', async () => {
    const adapter = replaying('prv-081-replay');
    await generate(adapter, 'extractor');
    await expect(generate(adapter, 'extractor')).rejects.toThrow(
      path.join(fixturesRoot, 'prv-081-replay', '002-extractor.json'),
    );
  });

  it("PRV-081: file names number each role's calls from 001", () => {
    expect(fixtureFileName('narrator', 1)).toBe('001-narrator.json');
    expect(fixtureFileName('npc-voice', 12)).toBe('012-npc-voice.json');
  });

  it("PRV-012: a fixture in a provider's wire format is rejected, naming the file", async () => {
    const adapter = replaying('prv-012-wire-format');
    const file = path.join(fixturesRoot, 'prv-012-wire-format', '001-narrator.json');
    await expect(generate(adapter, 'narrator')).rejects.toThrow(file);
    await expect(generate(replaying('prv-012-wire-format'), 'narrator')).rejects.toThrow(
      'not a TextResponse',
    );
  });
});

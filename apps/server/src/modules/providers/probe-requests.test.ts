import { err } from '@mythos/contracts';
import { HARD_FLOOR } from '@mythos/core';
import { describe, expect, it } from 'vitest';
import { mockProviderError } from './mock-outputs';
import { PROBE_SCHEMA_NAME, ProbeAnswerSchema } from './probe-prompts';
import {
  answer,
  failure,
  narration,
  probeHarness,
  sentKinds,
  valid,
  valueOf,
} from './probe-testing';
import { gate, TEST_START } from './queue-testing';
import { adaptSchema, toJsonSchema } from './schema-adapt';
import { estimateTokens } from './tokens';

describe('the probe: what it sends', () => {
  it('PRV-090: the structured requests go first and the text request last', async () => {
    const harness = probeHarness();
    await harness.probe();
    expect(sentKinds(harness.mock)).toEqual(['json-schema', 'tool-call', 'prompt-only', 'text']);
  });

  it("PRV-090: the text prompt is about 1,000 tokens, opens with the probe's time, and ends its instructions with the hard floor", async () => {
    const harness = probeHarness();
    await harness.probe();
    const textRequest = harness.mock.requests[3];
    expect(textRequest?.format).toEqual({ type: 'text' });
    expect(textRequest?.onDelta).toBeTypeOf('function');
    const messages = textRequest?.messages ?? [];
    const size = estimateTokens(messages.map((message) => message.content).join(''), 4);
    expect(size).toBeGreaterThanOrEqual(900);
    expect(size).toBeLessThanOrEqual(1100);
    expect(messages[0]?.role).toBe('system');
    expect(
      messages[0]?.content.startsWith(`Settings probe, ${new Date(TEST_START).toISOString()}.`),
    ).toBe(true);
    expect(messages[0]?.content.endsWith(HARD_FLOOR)).toBe(true);
  });

  it("PRV-090: each structured request has the hard floor and its method's format instruction", async () => {
    const harness = probeHarness();
    await harness.probe();
    for (const req of harness.mock.requests.slice(0, 3)) {
      const [instructions, format] = req.messages;
      expect(instructions?.content.endsWith(HARD_FLOOR)).toBe(true);
      expect(format).toMatchObject({ role: 'system' });
      expect(format?.content).toContain(
        `Answer with a single JSON object for "${PROBE_SCHEMA_NAME}"`,
      );
      expect(req.format).toMatchObject({ type: 'json', schemaName: PROBE_SCHEMA_NAME });
    }
    const promptOnly = harness.mock.requests[2]?.messages[1]?.content ?? '';
    expect(promptOnly).toContain('The object must match this JSON Schema:');
  });

  it("PRV-092: every request runs as an interactive job on the profile's device, with no campaign, as the narrator", async () => {
    const harness = probeHarness();
    await harness.probe();
    const machineLevel = { deviceId: 'gpu', campaignId: null, turnId: null };
    expect(harness.where).toEqual([machineLevel, machineLevel, machineLevel, machineLevel]);
    expect(harness.mock.requests.map((req) => req.role)).toEqual([
      'narrator',
      'narrator',
      'narrator',
      'narrator',
    ]);
  });

  it('PRV-092: each method is forced with a copy of the profile, which keeps its own sampling and output limit', async () => {
    const harness = probeHarness();
    await harness.probe();
    const [profile] = harness.config.modelProfiles;
    const methodRequests = harness.mock.requests.slice(0, 3);
    expect(methodRequests.map((req) => req.profile === profile)).toEqual([false, false, false]);
    expect(methodRequests.map((req) => req.profile.structuredOutput)).toEqual([
      'json-schema',
      'tool-call',
      'prompt-only',
    ]);
    for (const req of harness.mock.requests) {
      expect(req.sampling).toEqual({ temperature: 0.7 });
      expect(req.maxOutputTokens).toBe(512);
    }
    expect(profile?.structuredOutput).toBe('json-schema');
  });

  it('PRV-092: an Anthropic provider gets the schema adapted for each constrained method', async () => {
    const harness = probeHarness({
      provider: { id: 'cloud', type: 'anthropic', deviceId: 'gpu', apiKey: { value: 'test-key' } },
    });
    await harness.probe();
    const schemas = harness.mock.requests
      .slice(0, 3)
      .map((req) => (req.format.type === 'json' ? req.format.jsonSchema : null));
    const plain = toJsonSchema(ProbeAnswerSchema);
    expect(schemas).toEqual([
      adaptSchema(plain, 'anthropic', 'json-schema'),
      adaptSchema(plain, 'anthropic', 'tool-call'),
      plain,
    ]);
    expect(schemas[0]).toMatchObject({ additionalProperties: false });
    expect(JSON.stringify(schemas[0])).not.toContain('maxLength');
  });

  it('PRV-092: a failed request is tried once, never retried by the queue', async () => {
    const harness = probeHarness();
    harness.mock.script(
      'narrator',
      failure('provider_unavailable'),
      answer(valid),
      answer(valid),
      narration,
    );
    const result = valueOf(await harness.probe());
    expect(harness.mock.requests).toHaveLength(4);
    expect(harness.timer.delays).toEqual([]);
    expect(result.structuredMethods['json-schema']).toBe(false);
    expect(result.suggestions).toEqual([
      'The mock provider is unavailable.',
      'Use tool-call for structured output: the json-schema request failed.',
    ]);
  });

  it('PRV-092: nothing is recorded: no campaign is opened and no event is published', async () => {
    const harness = probeHarness();
    await harness.probe();
    expect(harness.opened).toEqual([]);
    expect(harness.published).toEqual([]);
  });

  it('PRV-092: aborting the probe cancels its running request and returns cancelled', async () => {
    const harness = probeHarness();
    const started = gate<undefined>();
    harness.use({
      ...harness.mock,
      text: {
        generate: (req) =>
          new Promise((resolve) => {
            started.open(undefined);
            req.signal.addEventListener(
              'abort',
              () => {
                resolve(err(mockProviderError('cancelled')));
              },
              { once: true },
            );
          }),
      },
    });
    const controller = new AbortController();
    const pending = harness.probe(controller.signal);
    await started.promise;
    controller.abort();
    const result = await pending;
    expect(result.ok ? null : result.error.code).toBe('cancelled');
    expect(harness.where).toHaveLength(1);
  });
});

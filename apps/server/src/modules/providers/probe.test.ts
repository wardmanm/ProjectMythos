import { err, ok } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { jsonPlaceholders, mockProviderError, mockResponse } from './mock-outputs';
import { PROBE_SCHEMA_NAME, ProbeAnswerSchema } from './probe-prompts';
import {
  answer,
  failure,
  narration,
  probeHarness,
  type ProviderInput,
  sentKinds,
  timedText,
  unparseable,
  usage,
  valid,
  valueOf,
  wrongShape,
} from './probe-testing';
import type { ProviderAdapter } from './types';

describe('the probe: structured-output methods', () => {
  it('PRV-031, PRV-090: json-schema output that does not parse and tool-call output that does are reported, and tool-call is suggested', async () => {
    const harness = probeHarness();
    harness.mock.script(
      'narrator',
      answer(unparseable),
      answer(valid),
      answer(wrongShape),
      narration,
    );
    const result = valueOf(await harness.probe());
    expect(result.structuredMethods).toEqual({
      'json-schema': false,
      'tool-call': true,
      'prompt-only': false,
    });
    expect(result.suggestions).toEqual([
      'Use tool-call for structured output: json-schema output did not parse.',
    ]);
  });

  it('PRV-031, PRV-090: json-schema rejected by the provider and tool-call valid suggests tool-call, with the provider message', async () => {
    const harness = probeHarness();
    harness.mock.script(
      'narrator',
      failure('provider_rejected', 'The server does not support response_format.'),
      answer(valid),
      answer(wrongShape),
      narration,
    );
    const result = valueOf(await harness.probe());
    expect(result.structuredMethods).toEqual({
      'json-schema': false,
      'tool-call': true,
      'prompt-only': false,
    });
    expect(result.suggestions).toEqual([
      'The server does not support response_format.',
      'Use tool-call for structured output: the provider rejected json-schema.',
    ]);
  });

  it('PRV-090: the fastest valid method is suggested, and a tie goes to the first in json-schema, tool-call, prompt-only order', async () => {
    const harness = probeHarness({ profile: { structuredOutput: 'prompt-only' } });
    const { mock, timer } = harness;
    const slowFirst: ProviderAdapter = {
      ...mock,
      text: {
        generate: async (req) => {
          const answered = await mock.text.generate(req);
          if (req.profile.structuredOutput === 'json-schema' && req.format.type === 'json') {
            timer.advance(900);
          }
          return answered;
        },
      },
    };
    harness.use(slowFirst);
    mock.script('narrator', answer(valid), answer(valid), answer(valid), narration);
    const result = valueOf(await harness.probe());
    expect(result.structuredMethods).toEqual({
      'json-schema': true,
      'tool-call': true,
      'prompt-only': true,
    });
    expect(result.suggestions).toEqual([
      'Use tool-call for structured output: it gave valid output fastest.',
    ]);
  });

  it('PRV-090: the profile keeps its method when that one is fastest', async () => {
    const harness = probeHarness();
    harness.mock.script('narrator', answer(valid), answer(wrongShape), answer(valid), narration);
    const result = valueOf(await harness.probe());
    expect(result.suggestions).toEqual([
      'Keep json-schema for structured output: it gave valid output fastest.',
    ]);
  });

  it('PRV-090: when no method gives valid output, the suggestion lists what went wrong with each', async () => {
    const harness = probeHarness();
    harness.mock.script(
      'narrator',
      answer(unparseable),
      answer(wrongShape),
      answer('No.', { finishReason: 'refusal' }),
      narration,
    );
    const result = valueOf(await harness.probe());
    expect(result.suggestions).toEqual([
      'No structured-output method gave valid output: json-schema output did not parse; ' +
        'tool-call output did not match the schema; the model refused the prompt-only request.',
    ]);
  });

  it('PRV-083, PRV-090: an unscripted mock profile passes every method, since the mock has a placeholder for the probe', async () => {
    expect(ProbeAnswerSchema.safeParse(jsonPlaceholders.get(PROBE_SCHEMA_NAME)).success).toBe(true);
    const result = valueOf(await probeHarness().probe());
    expect(result.structuredMethods).toEqual({
      'json-schema': true,
      'tool-call': true,
      'prompt-only': true,
    });
  });
});

describe('the probe: reachability and the model', () => {
  it("PRV-090: reachable and model present come from the provider's model list", async () => {
    const harness = probeHarness();
    const result = valueOf(await harness.probe());
    expect(result).toMatchObject({ profileId: 'test-model', reachable: true, modelPresent: true });
  });

  it('PRV-090: a model the provider does not list is reported, and the probe still runs', async () => {
    const harness = probeHarness({ profile: { model: 'not-installed' } });
    const result = valueOf(await harness.probe());
    expect(result.modelPresent).toBe(false);
    expect(result.suggestions[0]).toBe(
      'The provider does not list the model "not-installed". Check the profile\'s model name.',
    );
    expect(sentKinds(harness.mock)).toEqual(['json-schema', 'tool-call', 'prompt-only', 'text']);
  });

  it('PRV-090: an Ollama model named without a tag is present as its :latest', async () => {
    const provider: ProviderInput = {
      id: 'local',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      deviceId: 'gpu',
    };
    const listed = () => Promise.resolve(ok(['qwen3:latest', 'llama3:8b']));
    const tagless = probeHarness({ provider, profile: { model: 'qwen3' } });
    tagless.use({ ...tagless.mock, listModels: listed });
    expect(valueOf(await tagless.probe()).modelPresent).toBe(true);

    const otherTag = probeHarness({ provider, profile: { model: 'llama3' } });
    otherTag.use({ ...otherTag.mock, listModels: listed });
    expect(valueOf(await otherTag.probe()).modelPresent).toBe(false);
  });

  it('PRV-090: an unreachable provider is reported with its message, and no model request is sent', async () => {
    const harness = probeHarness();
    const message =
      'Could not connect to Ollama at http://localhost:11434: the connection was refused.';
    harness.use({
      ...harness.mock,
      listModels: () => Promise.resolve(err(mockProviderError('provider_unavailable', message))),
    });
    expect(valueOf(await harness.probe())).toEqual({
      profileId: 'test-model',
      reachable: false,
      modelPresent: false,
      structuredMethods: {},
      promptTokensPerSecond: null,
      generationTokensPerSecond: null,
      emittedThinking: false,
      suggestions: [message],
    });
    expect(harness.mock.requests).toHaveLength(0);
    expect(harness.where).toHaveLength(0);
  });

  it('PRV-090: an embedding profile is checked for reachability and its model only', async () => {
    const harness = probeHarness({
      profile: { kind: 'embedding', embeddingDimensions: 8, contextWindow: 512 },
    });
    expect(valueOf(await harness.probe())).toEqual({
      profileId: 'test-model',
      reachable: true,
      modelPresent: true,
      structuredMethods: {},
      promptTokensPerSecond: null,
      generationTokensPerSecond: null,
      emittedThinking: false,
      suggestions: [],
    });
    expect(harness.mock.requests).toHaveLength(0);
  });

  it('PRV-090: a profile that is not in machine config is not_found', async () => {
    const result = await probeHarness().probe(undefined, 'missing');
    expect(result.ok ? null : result.error.code).toBe('not_found');
  });
});

describe('the probe: speed, thinking, and the context window', () => {
  it('PRV-090: prompt speed is the uncached prompt over the time to the first delta, and generation speed the output over the rest', async () => {
    const harness = probeHarness();
    harness.mock.script('narrator', answer(valid), answer(valid), answer(valid));
    harness.use(
      timedText(harness, {
        promptMs: 400,
        generationMs: 2000,
        response: mockResponse('The ferry bumps the quay.', { usage: usage(1100, 100, 100) }),
      }),
    );
    const result = valueOf(await harness.probe());
    expect(result.promptTokensPerSecond).toBe(2500);
    expect(result.generationTokensPerSecond).toBe(50);
    expect(result.emittedThinking).toBe(false);
  });

  it('PRV-090: thinking while the profile says off is reported, measured over the whole call, and turning it off on the server is suggested', async () => {
    const harness = probeHarness();
    harness.mock.script('narrator', answer(valid), answer(valid), answer(valid));
    harness.use(
      timedText(harness, {
        promptMs: 500,
        generationMs: 1500,
        response: mockResponse('The ferry bumps the quay.', {
          thinking: 'The player has just arrived.',
          usage: usage(1000, 100),
        }),
      }),
    );
    const result = valueOf(await harness.probe());
    expect(result.emittedThinking).toBe(true);
    expect(result.promptTokensPerSecond).toBeNull();
    expect(result.generationTokensPerSecond).toBe(50);
    expect(result.suggestions).toContain(
      'The model thought before answering, although this profile turns thinking off. ' +
        'Turn thinking off on the server too, in its settings for this model: ' +
        'thinking slows every call.',
    );
  });

  it('PRV-090: thinking in a structured answer counts, and a profile with thinking on gets no suggestion about it', async () => {
    const harness = probeHarness({ profile: { thinking: 'on' } });
    harness.mock.script(
      'narrator',
      answer(valid, { thinking: 'An inn name, then a number.' }),
      answer(valid),
      answer(valid),
      narration,
    );
    const result = valueOf(await harness.probe());
    expect(result.emittedThinking).toBe(true);
    expect(result.suggestions).toEqual([
      'Keep json-schema for structured output: it gave valid output fastest.',
    ]);
  });

  it('PRV-090: a text profile whose context window is below 8,192 tokens gets a warning (CTX-032)', async () => {
    const small = valueOf(await probeHarness({ profile: { contextWindow: 4096 } }).probe());
    expect(small.suggestions).toContain(
      "This profile's context window is 4,096 tokens. Below 8,192, prompts may not fit and " +
        'turns can fail: raise it if the model and the machine allow.',
    );
    const enough = valueOf(await probeHarness({ profile: { contextWindow: 8192 } }).probe());
    expect(enough.suggestions.some((line) => line.includes('context window'))).toBe(false);
  });

  it('PRV-090: a failed text request leaves the speeds null, and its message becomes a suggestion', async () => {
    const harness = probeHarness({ profile: { thinking: 'off' } });
    const hint =
      'Anthropic rejected the request (400). This profile turns thinking off, which some ' +
      "Anthropic models do not allow; if that is the problem, set the profile's thinking to " +
      'provider-default in Settings.';
    harness.mock.script(
      'narrator',
      answer(valid),
      answer(valid),
      answer(valid),
      failure('provider_rejected', hint),
    );
    const result = valueOf(await harness.probe());
    expect(result.promptTokensPerSecond).toBeNull();
    expect(result.generationTokensPerSecond).toBeNull();
    expect(result.suggestions).toEqual([
      hint,
      'Keep json-schema for structured output: it gave valid output fastest.',
    ]);
  });

  it('PRV-090: the same failure in several requests is suggested once', async () => {
    const harness = probeHarness();
    const down = failure('provider_unavailable', 'The server closed the connection.');
    harness.mock.script('narrator', down, down, down, down);
    const result = valueOf(await harness.probe());
    expect(result.suggestions).toEqual([
      'The server closed the connection.',
      'No structured-output method gave valid output: the json-schema request failed; ' +
        'the tool-call request failed; the prompt-only request failed.',
    ]);
  });
});

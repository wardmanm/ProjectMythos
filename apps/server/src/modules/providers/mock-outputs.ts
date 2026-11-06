// What the mock provider returns when no test has scripted it and no fixtures are set:
// short placeholder text per role, placeholder JSON per schema, and deterministic
// embeddings (PRV-083). Also the helpers tests use to script it (PRV-080, PRV-084).
import type { ChatMessage, ModelRole } from '@mythos/contracts';
import { estimateTokens } from './tokens';
import type { ProviderError, TextRequest, TextResponse } from './types';

/** One scripted result for one call: a response, or an error after optional partial text. */
export type MockOutcome =
  | { type: 'response'; response: TextResponse }
  | { type: 'error'; error: ProviderError; partialText?: string };

/** The ratio the mock uses for the usage it reports. Real providers count their own. */
const MOCK_CHARS_PER_TOKEN = 4;

/**
 * Placeholder text per role, cycled by the role's call count. The embedder never makes a
 * text call, but every role has lines so the lookup needs no fallback.
 */
const textPlaceholders: Record<ModelRole, readonly [string, ...string[]]> = {
  narrator: [
    'Rain needles the shutters while the lamps burn low. Somewhere below, a door bangs shut.',
    'The street is quieter than it should be. A dog barks once, then thinks better of it.',
    'Your words hang in the air a moment before anyone answers.',
  ],
  'npc-voice': [
    '"I have said all I mean to say," she says, folding her arms.',
    '"Ask me again tomorrow," he mutters, not meeting your eye.',
  ],
  adjudicator: ['No roll is needed: the action succeeds as described.'],
  extractor: ['Nothing happened that needs recording.'],
  consolidator: ['A quiet stretch of days passed without incident.'],
  'world-ticker': ['The town goes about its business.'],
  embedder: ['The embedder makes no text calls.'],
  illustrator: ['A rain-dark harbour street at dusk, lamplight on wet cobbles.'],
  'speech-segmenter': ['The narration, unchanged.'],
};

/**
 * Placeholder output for each structured schema, keyed by `schemaName`. Phase 1 has only
 * the settings probe's (PRV-090), since no structured role runs in phase-1 play; each
 * later phase adds an entry for each schema it introduces, with a test that the entry
 * parses with that schema.
 */
export const jsonPlaceholders: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['probe', { inn: 'The Tarred Gull', rooms: 6 }],
]);

const providerErrors: Record<
  ProviderError['code'],
  { retryable: boolean; httpStatus: number | null; message: string }
> = {
  provider_unavailable: {
    retryable: true,
    httpStatus: 503,
    message: 'The mock provider is unavailable.',
  },
  provider_timeout: { retryable: true, httpStatus: null, message: 'The mock provider timed out.' },
  rate_limited: { retryable: true, httpStatus: 429, message: 'The mock provider is rate limited.' },
  provider_rejected: {
    retryable: false,
    httpStatus: 400,
    message: 'The mock provider rejected the request.',
  },
  cancelled: { retryable: false, httpStatus: null, message: 'The call was cancelled.' },
};

/**
 * A `ProviderError` as a real adapter maps it, with the retryability and HTTP status
 * PRV-013 gives each code. Implements PRV-084.
 */
export function mockProviderError(code: ProviderError['code'], message?: string): ProviderError {
  const shape = providerErrors[code];
  return {
    code,
    message: message ?? shape.message,
    retryable: shape.retryable,
    httpStatus: shape.httpStatus,
  };
}

/**
 * A complete `TextResponse` for `text`, for scripting the mock: no thinking, `stop`, and
 * usage estimated from the text. `inputTokens` is 0 unless given.
 */
export function mockResponse(
  text: string,
  overrides: Partial<Omit<TextResponse, 'text'>> = {},
): TextResponse {
  return {
    text,
    thinking: null,
    usage: {
      inputTokens: 0,
      outputTokens: estimateTokens(text, MOCK_CHARS_PER_TOKEN),
      cachedInputTokens: null,
    },
    finishReason: 'stop',
    ...overrides,
  };
}

/** Usage for a call the mock answered itself, estimated from the prompt and the text. */
export function mockUsage(messages: readonly ChatMessage[], text: string): TextResponse['usage'] {
  const prompt = messages.map((message) => message.content).join('');
  return {
    inputTokens: estimateTokens(prompt, MOCK_CHARS_PER_TOKEN),
    outputTokens: estimateTokens(text, MOCK_CHARS_PER_TOKEN),
    cachedInputTokens: null,
  };
}

/**
 * The default-mode outcome for a role's `call`th call (from 1): placeholder text, or the
 * placeholder for a JSON schema. A schema with no placeholder is `provider_rejected`, so a
 * missing entry fails loudly rather than returning invalid output. Implements PRV-083.
 */
export function defaultOutcome(
  req: TextRequest,
  call: number,
  placeholders: ReadonlyMap<string, unknown> = jsonPlaceholders,
): MockOutcome {
  if (req.format.type === 'json') {
    const { schemaName } = req.format;
    if (!placeholders.has(schemaName)) {
      const message =
        `The mock provider has no placeholder for schema "${schemaName}". ` +
        'Add one to jsonPlaceholders in mock-outputs.ts, or script the call.';
      return { type: 'error', error: mockProviderError('provider_rejected', message) };
    }
    return placeholderResponse(req, JSON.stringify(placeholders.get(schemaName)));
  }
  const lines = textPlaceholders[req.role];
  return placeholderResponse(req, lines[(call - 1) % lines.length] ?? lines[0]);
}

function placeholderResponse(req: TextRequest, text: string): MockOutcome {
  return {
    type: 'response',
    response: { text, thinking: null, usage: mockUsage(req.messages, text), finishReason: 'stop' },
  };
}

/**
 * A deterministic unit vector for `input`: the same input always gives the same vector,
 * and different inputs almost always differ. Implements PRV-083 for the embedder.
 */
export function mockEmbedding(input: string, dimensions: number): number[] {
  // An FNV-1a hash of the input seeds a xorshift sequence; both are a few lines of
  // integer arithmetic, so the vectors are identical on every machine.
  let state = fnv1a(input) || 1;
  const raw: number[] = [];
  for (let i = 0; i < dimensions; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    raw.push(state / 0xffffffff - 0.5);
  }
  const length = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0));
  return raw.map((value) => value / length);
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

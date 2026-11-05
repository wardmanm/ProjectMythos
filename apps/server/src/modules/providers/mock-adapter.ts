// The mock provider adapter, which every test uses instead of a real model (CONV-113) and
// which keeps the app clickable offline (PRV-083). It never touches the network.
//
// It answers each text call in one of three modes:
// - scripted, once a test has scripted anything: each call takes the next outcome queued
//   for its role, and an empty queue throws (PRV-080);
// - fixture, when the config has `fixturesDir`: each call reads its recorded file
//   (PRV-081);
// - default otherwise: placeholder output for every role (PRV-083).
import {
  err,
  type ModelProfile,
  type ModelRole,
  ok,
  type ProviderConfig,
  type ProviderHealth,
  type Result,
} from '@mythos/contracts';
import { readFixture } from './mock-fixtures';
import {
  defaultOutcome,
  mockEmbedding,
  type MockOutcome,
  mockProviderError,
  mockUsage,
} from './mock-outputs';
import type { ProviderAdapter, ProviderError, TextRequest, TextResponse } from './types';

/** A provider config whose `type` is `mock`. */
export type MockProviderConfig = Extract<ProviderConfig, { type: 'mock' }>;

/** The mock adapter: always has text and embedding members, and can be scripted. */
export type MockAdapter = ProviderAdapter & {
  readonly config: MockProviderConfig;
  readonly text: NonNullable<ProviderAdapter['text']>;
  readonly embedding: NonNullable<ProviderAdapter['embedding']>;
  /** Queues outcomes for a role's next calls, in order. Switches the mock to scripted mode. */
  script(role: ModelRole, ...outcomes: MockOutcome[]): void;
  /** Every text request received, in order, so a test can see what was sent. */
  readonly requests: readonly TextRequest[];
};

/**
 * Splits text into words, each with the whitespace after it, plus any leading whitespace
 * on its own; joined, the pieces are exactly the text.
 */
const WORDS = /\S+\s*|\s+/g;

/**
 * Builds a mock adapter from its provider config: its mode, `fixturesDir`, and the
 * `delayMs` it pauses after each streamed word. Implements PRV-080 to PRV-084.
 */
export function createMockAdapter(config: MockProviderConfig): MockAdapter {
  const scripts = new Map<ModelRole, MockOutcome[]>();
  let scripted = false;
  const callCounts = new Map<ModelRole, number>();
  const requests: TextRequest[] = [];

  function script(role: ModelRole, ...outcomes: MockOutcome[]): void {
    scripted = true;
    scripts.set(role, [...(scripts.get(role) ?? []), ...outcomes]);
  }

  async function outcomeFor(req: TextRequest, call: number): Promise<MockOutcome> {
    if (scripted) {
      const next = scripts.get(req.role)?.shift();
      if (next === undefined) {
        throw new Error(
          `Mock provider: nothing is scripted for ${req.role} call ${String(call)}. ` +
            `Script it with mock.script('${req.role}', …).`,
        );
      }
      return next;
    }
    if (config.fixturesDir !== undefined) {
      return { type: 'response', response: await readFixture(config.fixturesDir, req.role, call) };
    }
    return defaultOutcome(req, call);
  }

  async function generate(req: TextRequest): Promise<Result<TextResponse, ProviderError>> {
    requests.push(req);
    // Counted before any await, so concurrent calls get their numbers in call order.
    const call = (callCounts.get(req.role) ?? 0) + 1;
    callCounts.set(req.role, call);

    const outcome = await outcomeFor(req, call);
    const text = outcome.type === 'response' ? outcome.response.text : (outcome.partialText ?? '');
    const played = await play(text, req, config.delayMs);
    if (played.aborted) {
      const thinking = outcome.type === 'response' ? outcome.response.thinking : null;
      return cancelled(req, played.sent, thinking);
    }
    return outcome.type === 'response' ? ok(outcome.response) : err(outcome.error);
  }

  async function embed(
    profile: ModelProfile,
    inputs: string[],
    signal: AbortSignal,
  ): Promise<Result<number[][], ProviderError>> {
    const dimensions = profile.embeddingDimensions;
    if (dimensions === undefined) {
      throw new Error(`Profile ${profile.id} has no embeddingDimensions (PRV-002).`);
    }
    if (!(await pause(config.delayMs, signal))) return err(mockProviderError('cancelled'));
    return ok(inputs.map((input) => mockEmbedding(input, dimensions)));
  }

  return {
    config,
    health: (): Promise<ProviderHealth> =>
      Promise.resolve({ reachable: true, latencyMs: 0, detail: 'The mock provider is ready.' }),
    listModels: (): Promise<Result<string[], ProviderError>> => Promise.resolve(ok(['mock'])),
    text: { generate },
    embedding: { embed },
    script,
    requests,
  };
}

/**
 * Plays a call's text: streamed to `onDelta` a word at a time with a pause after each
 * word, or, for a call that is not streamed or has no text, one pause. Returns the text
 * that got through before an abort. Thinking is never played. Implements PRV-083.
 */
async function play(
  text: string,
  req: TextRequest,
  delayMs: number,
): Promise<{ sent: string; aborted: boolean }> {
  const { onDelta, signal } = req;
  const words = text.match(WORDS) ?? [];
  if (onDelta === undefined || words.length === 0) {
    return { sent: '', aborted: !(await pause(delayMs, signal)) };
  }
  let sent = '';
  for (const word of words) {
    if (signal.aborted) return { sent, aborted: true };
    onDelta(word);
    sent += word;
    if (!(await pause(delayMs, signal))) return { sent, aborted: true };
  }
  return { sent, aborted: false };
}

/**
 * An aborted call: the text that arrived, marked `cancelled`, or the `cancelled` error if
 * none did. Implements PRV-047.
 */
function cancelled(
  req: TextRequest,
  sent: string,
  thinking: string | null,
): Result<TextResponse, ProviderError> {
  if (sent === '') return err(mockProviderError('cancelled'));
  return ok({
    text: sent,
    thinking,
    usage: mockUsage(req.messages, sent),
    finishReason: 'cancelled',
  });
}

/**
 * Waits `ms` with the global `setTimeout`, so a test's fake timers control it. Resolves
 * true when the time is up, or false as soon as `signal` aborts.
 */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (ms === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

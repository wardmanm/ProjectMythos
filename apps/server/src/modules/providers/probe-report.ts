// The pure half of the settings probe (PRV-090): whether each method's answer was valid,
// the speeds from usage and timing, and the suggestions, in plain words, that the settings
// screen shows beside the result.
import type {
  AppError,
  ModelProfile,
  ProbeResult,
  ProviderConfig,
  Result,
} from '@mythos/contracts';
import { ProbeAnswerSchema } from './probe-prompts';
import { checkOutput } from './structured-output';
import type { TextResponse } from './types';

/** A structured-output method, as a profile names it. */
export type Method = ModelProfile['structuredOutput'];

/** Every text provider implements all three (PRV-023, PRV-030, PRV-040), tried in this order. */
export const METHODS: readonly Method[] = ['json-schema', 'tool-call', 'prompt-only'];

/** Below this context window the settings screen warns (CTX-032). */
export const MIN_CONTEXT_WINDOW = 8_192;

/** One answer, with the wall times its job saw: start, first answer delta, and end. */
export type Timed = {
  response: TextResponse;
  startedAt: number;
  firstDeltaAt: number | null;
  endedAt: number;
};

/** What one method's request showed. */
export type MethodCheck = {
  method: Method;
  valid: boolean;
  /** Why it was not valid, as a clause, e.g. "json-schema output did not parse". */
  problem: string | null;
  /** The provider's message, when the request failed there. */
  failure: string | null;
  /** Time spent in its job, for picking the fastest; null when it was not valid. */
  workMs: number | null;
  thinking: boolean;
};

/** Whether a response carries any thinking. */
function thought(response: TextResponse): boolean {
  return response.thinking !== null && response.thinking !== '';
}

/** Checks one method's answer with the probe's schema, as the pipeline would (PRV-050). */
export function checkMethod(method: Method, sent: Result<Timed, AppError>): MethodCheck {
  const none = { method, failure: null, workMs: null, thinking: false };
  if (!sent.ok) {
    const problem =
      sent.error.code === 'provider_rejected'
        ? `the provider rejected ${method}`
        : `the ${method} request failed`;
    return { ...none, valid: false, problem, failure: sent.error.message };
  }
  const { response, startedAt, endedAt } = sent.value;
  const thinking = thought(response);
  if (response.finishReason === 'refusal') {
    return { ...none, thinking, valid: false, problem: `the model refused the ${method} request` };
  }
  const checked = checkOutput(response.text, ProbeAnswerSchema, undefined);
  if (checked.ok)
    return { ...none, thinking, valid: true, problem: null, workMs: endedAt - startedAt };
  const problem =
    checked.error.parseError === null
      ? `${method} output did not match the schema`
      : `${method} output did not parse`;
  return { ...none, thinking, valid: false, problem };
}

/** Tokens per second, or null when there is nothing to measure. */
function perSecond(tokens: number, ms: number): number | null {
  return tokens > 0 && ms > 0 ? tokens / (ms / 1000) : null;
}

/**
 * Prompt speed is the uncached prompt over the time to the first answer delta, and
 * generation speed the output over the time from that delta to the end. Thinking comes
 * before the first answer delta, so with thinking only generation speed is given, over
 * the whole call.
 */
export function speedsOf(timed: Timed): { prompt: number | null; generation: number | null } {
  const { response, startedAt, firstDeltaAt, endedAt } = timed;
  const { inputTokens, outputTokens, cachedInputTokens } = response.usage;
  if (thought(response)) {
    return { prompt: null, generation: perSecond(outputTokens, endedAt - startedAt) };
  }
  if (firstDeltaAt === null) return { prompt: null, generation: null };
  return {
    prompt: perSecond(inputTokens - (cachedInputTokens ?? 0), firstDeltaAt - startedAt),
    generation: perSecond(outputTokens, endedAt - firstDeltaAt),
  };
}

/** Whether the provider lists the model. Ollama reads a name with no tag as `:latest`. */
export function listsModel(
  models: readonly string[],
  model: string,
  providerType: ProviderConfig['type'],
): boolean {
  if (models.includes(model)) return true;
  return providerType === 'ollama' && !model.includes(':') && models.includes(`${model}:latest`);
}

/** Everything the probe learned about a text profile. */
export type TextFindings = {
  profile: ModelProfile;
  modelPresent: boolean;
  checks: readonly MethodCheck[];
  text: Result<Timed, AppError>;
};

/** The probe's result for a text profile it could reach. Implements PRV-090 and PRV-031. */
export function textProfileResult(findings: TextFindings): ProbeResult {
  const { profile, modelPresent, checks, text } = findings;
  const structuredMethods: ProbeResult['structuredMethods'] = {};
  for (const check of checks) structuredMethods[check.method] = check.valid;
  const speeds = text.ok ? speedsOf(text.value) : { prompt: null, generation: null };
  const emittedThinking =
    checks.some((check) => check.thinking) || (text.ok && thought(text.value.response));
  const failures = [
    ...checks.flatMap((check) => (check.failure === null ? [] : [check.failure])),
    ...(text.ok ? [] : [text.error.message]),
  ];
  const suggestions = [
    ...(modelPresent ? [] : [notListed(profile)]),
    ...new Set(failures),
    methodSuggestion(profile.structuredOutput, checks),
    ...(emittedThinking && profile.thinking === 'off' ? [THINKING_OFF] : []),
    ...(profile.contextWindow < MIN_CONTEXT_WINDOW ? [smallWindow(profile.contextWindow)] : []),
  ];
  return {
    profileId: profile.id,
    reachable: true,
    modelPresent,
    structuredMethods,
    promptTokensPerSecond: speeds.prompt,
    generationTokensPerSecond: speeds.generation,
    emittedThinking,
    suggestions,
  };
}

/** The result for a profile the probe sends nothing to: unreachable, or an embedding one. */
export function listingResult(
  profile: ModelProfile,
  listing: { reachable: boolean; modelPresent: boolean; suggestions: string[] },
): ProbeResult {
  return {
    profileId: profile.id,
    reachable: listing.reachable,
    modelPresent: listing.modelPresent,
    structuredMethods: {},
    promptTokensPerSecond: null,
    generationTokensPerSecond: null,
    emittedThinking: false,
    suggestions: listing.suggestions,
  };
}

export function notListed(profile: ModelProfile): string {
  return `The provider does not list the model "${profile.model}". Check the profile's model name.`;
}

/**
 * The fastest method that gave valid output, against the profile's own. A tie goes to the
 * first in `METHODS`, since the sort is stable.
 */
function methodSuggestion(current: Method, checks: readonly MethodCheck[]): string {
  const fastest = checks
    .filter((check) => check.valid)
    .sort((a, b) => (a.workMs ?? 0) - (b.workMs ?? 0))[0];
  if (fastest === undefined) {
    const problems = checks.map((check) => check.problem ?? `${check.method} failed`);
    return `No structured-output method gave valid output: ${problems.join('; ')}.`;
  }
  if (fastest.method === current) {
    return `Keep ${current} for structured output: it gave valid output fastest.`;
  }
  const own = checks.find((check) => check.method === current);
  const why = own?.problem ?? 'it gave valid output fastest';
  return `Use ${fastest.method} for structured output: ${why}.`;
}

/** The profile already says off, so the server is where thinking must be turned off. */
const THINKING_OFF =
  'The model thought before answering, although this profile turns thinking off. ' +
  'Turn thinking off on the server too, in its settings for this model: ' +
  'thinking slows every call.';

function smallWindow(contextWindow: number): string {
  return (
    `This profile's context window is ${grouped(contextWindow)} tokens. Below ` +
    `${grouped(MIN_CONTEXT_WINDOW)}, prompts may not fit and turns can fail: raise it if ` +
    'the model and the machine allow.'
  );
}

/** A whole number with commas between thousands, the same on every machine. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

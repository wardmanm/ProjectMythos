// The settings probe (PRV-090): tests one model profile and reports what works. It lists
// the provider's models, sends one tiny structured request with each method, then one
// text prompt of about 1,000 tokens, timed, so the model is loaded by the time its speed
// is measured. It calls the adapter itself, not callStructured, so it can force each
// method, and it records nothing, since model call records belong to campaigns (PRV-092).
import {
  type AppError,
  err,
  type ModelProfile,
  ok,
  type ProbeResult,
  type ProviderConfig,
  type Result,
  type TimeSource,
} from '@mythos/contracts';
import type { ConfigStore } from '../config';
import {
  PROBE_SCHEMA_NAME,
  ProbeAnswerSchema,
  structuredProbeMessages,
  textProbeMessages,
} from './probe-prompts';
import {
  checkMethod,
  listingResult,
  listsModel,
  type Method,
  type MethodCheck,
  METHODS,
  notListed,
  textProfileResult,
  type Timed,
} from './probe-report';
import type { JobQueue } from './queue';
import { adaptSchema, toJsonSchema } from './schema-adapt';
import { formatInstruction, withFormatInstruction } from './structured-output';
import type { ProviderAdapter, TextRequest } from './types';

/** What the probe needs from the composition root (ARCH-022). */
export type ProbeOptions = {
  /** Read once per probe, so it tests the profile as saved (PRV-004). */
  config: Pick<ConfigStore, 'current'>;
  queue: Pick<JobQueue, 'runInteractive' | 'cancel'>;
  /** The adapter for a provider in machine config: `createAdapter(provider, deps)`. */
  adapterFor: (provider: ProviderConfig) => ProviderAdapter;
  /** Wall time for the speeds and the text prompt's opening line (CONV-061). */
  timeSource: TimeSource;
};

export type ProviderProbe = {
  /**
   * Probes one profile. A profile that is not in machine config is `not_found`; aborting
   * `signal` cancels the request in flight and returns `cancelled`.
   */
  probe: (profileId: string, signal: AbortSignal) => Promise<Result<ProbeResult, AppError>>;
};

/** Builds the probe. Called once, by the composition root (ARCH-022). */
export function createProbe(options: ProbeOptions): ProviderProbe {
  return { probe: (profileId, signal) => runProbe(options, profileId, signal) };
}

const CANCELLED: AppError = { code: 'cancelled', message: 'The probe was cancelled.' };

/**
 * Whether the caller has aborted. Read through a call, since TypeScript would otherwise
 * keep `signal.aborted` narrowed to false across the awaits between checks.
 */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** A request as the probe builds it; the job adds its signal, and the text request `onDelta`. */
type Draft = Omit<TextRequest, 'signal' | 'onDelta'>;

/** Implements PRV-090, PRV-092, and PRV-031. */
async function runProbe(
  deps: ProbeOptions,
  profileId: string,
  signal: AbortSignal,
): Promise<Result<ProbeResult, AppError>> {
  const state = deps.config.current();
  if (!state.ok) return err(state.error);
  const profile = state.value.modelProfiles.find((each) => each.id === profileId);
  if (profile === undefined) {
    return err({ code: 'not_found', message: `There is no model profile "${profileId}".` });
  }
  const provider = state.value.providers.find((each) => each.id === profile.providerId);
  if (provider === undefined) {
    throw new Error(
      `Profile "${profile.id}" names provider "${profile.providerId}", which is missing.`,
    );
  }
  const adapter = deps.adapterFor(provider);
  // A GET like `health`, not a model request, so it takes no slot on the device.
  const listed = await adapter.listModels(signal);
  if (aborted(signal)) return err(CANCELLED);
  if (!listed.ok) {
    const listing = { reachable: false, modelPresent: false, suggestions: [listed.error.message] };
    return ok(listingResult(profile, listing));
  }
  const modelPresent = listsModel(listed.value, profile.model, provider.type);
  if (profile.kind === 'embedding') {
    const suggestions = modelPresent ? [] : [notListed(profile)];
    return ok(listingResult(profile, { reachable: true, modelPresent, suggestions }));
  }
  if (adapter.text === undefined) {
    const message = `Provider "${provider.id}" serves no text models, which profile "${profile.id}" needs.`;
    return err({ code: 'not_configured', message });
  }
  const send = sender(deps, provider, adapter.text, signal);
  const checks: MethodCheck[] = [];
  for (const method of METHODS) {
    const sent = await send(structuredDraft(profile, provider, method), false);
    if (aborted(signal)) return err(CANCELLED);
    checks.push(checkMethod(method, sent));
  }
  const text = await send(textDraft(profile, deps.timeSource.now()), true);
  if (aborted(signal)) return err(CANCELLED);
  return ok(textProfileResult({ profile, modelPresent, checks, text }));
}

/**
 * The structured request for one method: a copy of the profile with that method, which is
 * how a method is forced (05-providers Decisions), and the schema adapted for it (PRV-052).
 */
function structuredDraft(profile: ModelProfile, provider: ProviderConfig, method: Method): Draft {
  const jsonSchema = toJsonSchema(ProbeAnswerSchema);
  const instruction = formatInstruction(method, PROBE_SCHEMA_NAME, jsonSchema);
  return {
    role: 'narrator',
    profile: { ...profile, structuredOutput: method },
    messages: withFormatInstruction(structuredProbeMessages(), instruction),
    format: {
      type: 'json',
      schemaName: PROBE_SCHEMA_NAME,
      jsonSchema: adaptSchema(jsonSchema, provider.type, method),
    },
    maxOutputTokens: profile.maxOutputTokens,
    sampling: profile.sampling,
  };
}

function textDraft(profile: ModelProfile, startedAt: number): Draft {
  return {
    role: 'narrator',
    profile,
    messages: textProbeMessages(startedAt),
    format: { type: 'text' },
    maxOutputTokens: profile.maxOutputTokens,
    sampling: profile.sampling,
  };
}

/**
 * Sends each request as an interactive job on the provider's device, with no campaign
 * (PRV-092), timed inside the job so time spent queued does not count. Aborting `signal`
 * cancels the job, which aborts the request (PRV-061). A failure comes back with
 * `retryable: false`, so the queue never retries it: each method gets one try (owner).
 */
function sender(
  deps: ProbeOptions,
  provider: ProviderConfig,
  textMember: NonNullable<ProviderAdapter['text']>,
  signal: AbortSignal,
) {
  const where = { deviceId: provider.deviceId, campaignId: null, turnId: null };
  return async (draft: Draft, timeFirstDelta: boolean): Promise<Result<Timed, AppError>> => {
    const { jobId, result } = deps.queue.runInteractive(where, async (ctx) => {
      const startedAt = deps.timeSource.now();
      let firstDeltaAt: number | null = null;
      const onDelta = (delta: string): void => {
        if (firstDeltaAt === null && delta !== '') firstDeltaAt = deps.timeSource.now();
      };
      const answered = await textMember.generate({
        ...draft,
        signal: ctx.signal,
        ...(timeFirstDelta ? { onDelta } : {}),
      });
      const endedAt = deps.timeSource.now();
      if (!answered.ok) return err({ ...answered.error, retryable: false });
      return ok({ response: answered.value, startedAt, firstDeltaAt, endedAt });
    });
    const cancel = (): void => {
      deps.queue.cancel(jobId);
    };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    try {
      return await result;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  };
}

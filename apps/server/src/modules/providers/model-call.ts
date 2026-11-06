// One model call, from its role's route to its stored record: what `callStructured` and
// `streamText` share. Each adapter call runs where PRV-067 says, in its job's slot or as
// an interactive job, and every run is recorded as an attempt (PRV-054) and calibrated
// (PRV-071).
import { randomUUID } from 'node:crypto';
import {
  type AppError,
  type ChatMessage,
  err,
  type ModelCallAttempt,
  type ModelProfile,
  type ModelRole,
  ok,
  type ProviderConfig,
  type Result,
  type TimeSource,
} from '@mythos/contracts';
import type { ConfigStore } from '../config';
import type { CampaignStore } from '../storage';
import type { JobContext, JobQueue, QueueLogger } from './queue';
import { attemptOf, type CallOutcome, writeRecord } from './records';
import { type RoleRoute, routeRole } from './role-routing';
import type { PromptReport } from './structured';
import { type Calibration, estimateTokens } from './tokens';
import type { ProviderAdapter, ResponseFormat, TextResponse } from './types';

/** What the model calls need from the composition root (ARCH-022). */
export type ModelCallsOptions = {
  /** Read once per call, so a change in Settings applies to the next one (PRV-004). */
  config: Pick<ConfigStore, 'current'>;
  queue: Pick<JobQueue, 'runInteractive' | 'cancel'>;
  /** The adapter for a provider in machine config: `createAdapter(provider, deps)`. */
  adapterFor: (provider: ProviderConfig) => ProviderAdapter;
  /** Where records are stored. */
  campaigns: Pick<CampaignStore, 'openCampaign'>;
  calibration: Calibration;
  /** Wall time for `createdAt` and each attempt's `durationMs` (CONV-061). */
  timeSource: TimeSource;
  logger: QueueLogger;
};

/** The fields of `StructuredCallOptions` and `StreamTextOptions` that say where a call goes. */
export type CallTarget = {
  role: ModelRole;
  report: PromptReport;
  campaignId: string;
  turnId: string | null;
  signal: AbortSignal;
  job: JobContext | null;
};

/** One adapter call within a model call. */
export type SendOptions = {
  /** The routed profile, or a copy with another `structuredOutput` (PRV-053). */
  profile: ModelProfile;
  method: ModelCallAttempt['method'];
  messages: readonly ChatMessage[];
  format: ResponseFormat;
  onDelta?: (delta: string) => void;
  /** True once text has reached the caller; an error after that is not retried (PRV-047). */
  textStreamed?: () => boolean;
};

/** An answer, and the attempt it was recorded as, which validation adds problems to. */
export type Sent = { response: TextResponse; attempt: ModelCallAttempt };

export type ModelCall = {
  readonly route: RoleRoute;
  /** Every attempt so far, in order. */
  readonly attempts: readonly ModelCallAttempt[];
  send(options: SendOptions): Promise<Result<Sent, AppError>>;
  /** Writes the call's record and passes `result` through. Called once, at the end. */
  finish<T>(
    outcome: CallOutcome,
    messages: readonly ChatMessage[],
    result: Result<T, AppError>,
  ): Result<T, AppError>;
};

/**
 * Starts a call: routes its role (PRV-001) and finds its adapter. A call that fails here
 * reached no model, so it has no record. Implements ARCH-060.
 */
export function startCall(
  deps: ModelCallsOptions,
  target: CallTarget,
): Result<ModelCall, AppError> {
  const state = deps.config.current();
  if (!state.ok) return err(state.error);
  const routed = routeRole(state.value, target.role);
  if (!routed.ok) return routed;
  const route = routed.value;
  const textMember = deps.adapterFor(route.provider).text;
  if (textMember === undefined) {
    const message = `Provider "${route.provider.id}" serves no text models, which profile "${route.profile.id}" needs.`;
    return err({ code: 'not_configured', message });
  }
  // Narrowed here, so the functions below, which are hoisted, see it as defined.
  const adapter = textMember;
  const createdAt = new Date(deps.timeSource.now()).toISOString();
  const attempts: ModelCallAttempt[] = [];

  /** One run of one adapter call, recorded and calibrated. The queue may run it again. */
  async function generate(
    options: SendOptions,
    signal: AbortSignal,
  ): Promise<Result<Sent, AppError>> {
    const { profile, messages, format, onDelta } = options;
    const prompt = messages.map((message) => message.content).join('');
    const estimated = estimateTokens(prompt, deps.calibration.charsPerToken(profile));
    const started = deps.timeSource.now();
    const result = await adapter.generate({
      role: target.role,
      profile,
      messages: [...messages],
      format,
      maxOutputTokens: profile.maxOutputTokens,
      sampling: route.sampling,
      signal,
      ...(onDelta === undefined ? {} : { onDelta }),
    });
    const attempt = attemptOf(
      attempts.length + 1,
      options.method,
      result,
      deps.timeSource.now() - started,
    );
    attempts.push(attempt);
    if (!result.ok) {
      // runInteractive retries a retryable error, which would stream the text again.
      const streamed = options.textStreamed?.() === true;
      return err(streamed ? { ...result.error, retryable: false } : result.error);
    }
    // A cancelled call's usage is an estimate, which would pull the ratio toward itself.
    if (result.value.finishReason !== 'cancelled') {
      calibrate(profile, estimated, result.value.usage.inputTokens);
    }
    return ok({ response: result.value, attempt });
  }

  /** Implements PRV-071: folds the reported prompt size into the profile's ratio. */
  function calibrate(profile: ModelProfile, estimated: number, reported: number): void {
    deps.calibration.calibrate(profile, estimated, reported).catch((error: unknown) => {
      deps.logger.warn({ profileId: profile.id, err: error }, 'calibration was not saved');
    });
  }

  /**
   * Implements PRV-061 and PRV-067: in the job's own slot under its signal, or as an
   * interactive job on the provider's device, cancelled when the caller's signal aborts.
   */
  async function send(options: SendOptions): Promise<Result<Sent, AppError>> {
    const { job, signal } = target;
    if (job !== null) return generate(options, AbortSignal.any([signal, job.signal]));
    const where = {
      deviceId: route.provider.deviceId,
      campaignId: target.campaignId,
      turnId: target.turnId,
    };
    const { jobId, result } = deps.queue.runInteractive(where, (ctx) =>
      generate(options, ctx.signal),
    );
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
  }

  function finish<T>(
    outcome: CallOutcome,
    messages: readonly ChatMessage[],
    result: Result<T, AppError>,
  ): Result<T, AppError> {
    const { report } = target;
    writeRecord(deps.campaigns, deps.logger, {
      id: randomUUID(),
      campaignId: target.campaignId,
      turnId: target.turnId,
      role: target.role,
      providerId: route.provider.id,
      profileId: route.profile.id,
      model: route.profile.model,
      messages: [...messages],
      tiers: report.tiers,
      retrieved: report.retrieved,
      templates: report.templates,
      attempts,
      outcome,
      createdAt,
    });
    return result;
  }

  return ok({ route, attempts, send, finish });
}

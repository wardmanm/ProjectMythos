import type { z } from 'zod';
import type {
  AppError,
  ChatMessage,
  ModelCallRecord,
  ModelRole,
  Result,
  SemanticIssue,
} from '@mythos/contracts';
import type { JobContext } from './queue';
import type { TextResponse } from './types';

/** The prompt's tiers, memories, and templates, recorded with the call (CTX-090). */
export type PromptReport = Pick<ModelCallRecord, 'tiers' | 'retrieved' | 'templates'>;

export type StructuredCallOptions<T> = {
  role: ModelRole;
  schemaName: string; // e.g. "ruling", "extraction"
  schema: z.ZodType<T>;
  messages: ChatMessage[];
  report: PromptReport;
  /** Runs after schema validation. Returning issues triggers a retry with them fed back. */
  semanticCheck?: (value: T) => SemanticIssue[];
  campaignId: string;
  turnId: string | null;
  signal: AbortSignal;
  /** The background job this call runs inside, or null to run as an interactive job (PRV-067). */
  job: JobContext | null;
};

/** Runs the full structured-output pipeline (PRV §5). Records every attempt (ARCH-060). */
export type CallStructured = <T>(options: StructuredCallOptions<T>) => Promise<Result<T, AppError>>;

export type StreamTextOptions = {
  role: ModelRole;
  messages: ChatMessage[];
  report: PromptReport;
  campaignId: string;
  turnId: string | null;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  /** The background job this call runs inside, or null to run as an interactive job (PRV-067). */
  job: JobContext | null;
};

/** Text that streamed. `finishReason` says whether it is complete (PRV-047, TRN-051). */
export type StreamedText = { text: string; finishReason: TextResponse['finishReason'] };

/** Streams plain text (narration, NPC voice). Records the call (ARCH-060). */
export type StreamText = (options: StreamTextOptions) => Promise<Result<StreamedText, AppError>>;

// ------------------------------------------------------------------ the implementation
// Everything above is the 05-providers §5 code block, copied verbatim. Below are the two
// calls every model call goes through. What they share, from routing the role to storing
// the record, is model-call.ts; the pure steps are structured-output.ts and
// schema-adapt.ts.
import { err, type ModelCallAttempt, type ModelProfile, ok } from '@mythos/contracts';
import { type ModelCallsOptions, startCall } from './model-call';
import { type CallOutcome, errorOutcome } from './records';
import { adaptSchema, type JsonSchema, toJsonSchema } from './schema-adapt';
import {
  checkOutput,
  formatInstruction,
  retryMessages,
  withFormatInstruction,
} from './structured-output';

/** PRV-050 step 7: at most this many retries after a problem in steps 5 and 6. */
const MAX_VALIDATION_RETRIES = 2;

/** The two model calls, which every module that needs a model is given. */
export type ModelCalls = { callStructured: CallStructured; streamText: StreamText };

/** Builds the model calls. Called once, by the composition root (ARCH-022). */
export function createModelCalls(options: ModelCallsOptions): ModelCalls {
  return {
    callStructured: <T>(call: StructuredCallOptions<T>) => runStructured(options, call),
    streamText: (call: StreamTextOptions) => runStreamText(options, call),
  };
}

/**
 * The structured-output pipeline (PRV-050): each answer is extracted, parsed with the
 * schema, and checked, and a problem is fed back for at most two retries. A provider that
 * refuses a `json-schema` or `tool-call` request is asked once more with `prompt-only`
 * (PRV-053), which is not a validation retry. Only a value that passed every check is
 * returned (CONV-032). Implements PRV-050, PRV-053, and CONV-032.
 */
async function runStructured<T>(
  deps: ModelCallsOptions,
  options: StructuredCallOptions<T>,
): Promise<Result<T, AppError>> {
  const started = startCall(deps, options);
  if (!started.ok) return err(started.error);
  const call = started.value;
  const { profile, provider } = call.route;
  const { schemaName } = options;
  const jsonSchema = toJsonSchema(options.schema);
  let method = profile.structuredOutput;
  let messages = instructed(options, method, jsonSchema);
  let retries = 0;
  // Each pass sends one request; every way out returns.
  for (;;) {
    const sent = await call.send({
      profile: { ...profile, structuredOutput: method },
      method,
      messages,
      format: {
        type: 'json',
        schemaName,
        jsonSchema: adaptSchema(jsonSchema, provider.type, method),
      },
    });
    if (!sent.ok) {
      if (sent.error.code === 'provider_rejected' && method !== 'prompt-only') {
        method = 'prompt-only';
        messages = instructed(options, method, jsonSchema);
        continue;
      }
      return call.finish(errorOutcome(sent.error), messages, err(sent.error));
    }
    const { response, attempt } = sent.value;
    const stopped = stoppedEarly(response);
    if (stopped !== null) return call.finish(errorOutcome(stopped), messages, err(stopped));
    const checked = checkOutput(response.text, options.schema, options.semanticCheck);
    if (checked.ok) {
      const outcome = method === profile.structuredOutput ? 'success' : 'fallback';
      return call.finish(outcome, messages, ok(checked.value));
    }
    // The attempt is already in the record; its problems go on it.
    attempt.parseError = checked.error.parseError;
    attempt.schemaIssues = checked.error.schemaIssues;
    attempt.semanticIssues = checked.error.semanticIssues;
    if (retries === MAX_VALIDATION_RETRIES) {
      return call.finish('failed', messages, err(invalidOutput(schemaName, call.attempts)));
    }
    retries += 1;
    messages = [...messages, ...retryMessages(response.text, checked.error)];
  }
}

/** The caller's messages with the format instruction for `method` (PRV-050 step 3). */
function instructed<T>(
  options: StructuredCallOptions<T>,
  method: ModelProfile['structuredOutput'],
  jsonSchema: JsonSchema,
): ChatMessage[] {
  const instruction = formatInstruction(method, options.schemaName, jsonSchema);
  return withFormatInstruction(options.messages, instruction);
}

/**
 * An answer that ends the call before validation: one cut off by a cancel (PRV-047), or
 * a refusal, which fails the call like any other provider refusal (CSET-050). The refusal
 * itself stays out of the message, since callers log it (CONV-072).
 */
function stoppedEarly(response: TextResponse): AppError | null {
  if (response.finishReason === 'cancelled') {
    return { code: 'cancelled', message: 'The model call was cancelled.' };
  }
  if (response.finishReason === 'refusal') {
    const message = 'The model refused to answer. Its reply is in the model call record.';
    return { code: 'provider_rejected', message };
  }
  return null;
}

/** PRV-050 step 8: `model_output_invalid`, with every attempt's problems in `details`. */
function invalidOutput(schemaName: string, attempts: readonly ModelCallAttempt[]): AppError {
  return {
    code: 'model_output_invalid',
    message: `The model's "${schemaName}" output was still invalid after ${String(attempts.length)} attempts.`,
    details: {
      attempts: attempts.map(
        ({ attempt, method, error, parseError, schemaIssues, semanticIssues }) => ({
          attempt,
          method,
          error,
          parseError,
          schemaIssues,
          semanticIssues,
        }),
      ),
    },
  };
}

/**
 * Streams plain text, such as narration (PRV-045). A profile with `streaming: true` sends
 * each delta as it arrives; one with streaming off sends what came back as one delta.
 * Thinking never reaches `onDelta`, since adapters keep it apart (PRV-046). An error
 * after text has reached `onDelta` is not retried, so the text never streams twice; a
 * cancel returns the text so far, marked `cancelled` (PRV-047). Implements PRV-045 to
 * PRV-047.
 */
async function runStreamText(
  deps: ModelCallsOptions,
  options: StreamTextOptions,
): Promise<Result<StreamedText, AppError>> {
  const started = startCall(deps, options);
  if (!started.ok) return err(started.error);
  const call = started.value;
  const { profile } = call.route;
  let streamed = false;
  const forward = (delta: string): void => {
    streamed = true;
    options.onDelta(delta);
  };
  const sent = await call.send({
    profile,
    method: 'text',
    messages: options.messages,
    format: { type: 'text' },
    ...(profile.streaming ? { onDelta: forward } : {}),
    textStreamed: () => streamed,
  });
  if (!sent.ok) return call.finish(errorOutcome(sent.error), options.messages, err(sent.error));
  const { text, finishReason } = sent.value.response;
  if (!profile.streaming && text !== '') options.onDelta(text);
  return call.finish(textOutcome(finishReason), options.messages, ok({ text, finishReason }));
}

/** A streamed call's outcome: a refusal fails the stage (CSET-050), and a cut-off one is kept. */
function textOutcome(finishReason: TextResponse['finishReason']): CallOutcome {
  switch (finishReason) {
    case 'cancelled':
      return 'cancelled';
    case 'refusal':
      return 'failed';
    case 'stop':
    case 'length':
      return 'success';
  }
}

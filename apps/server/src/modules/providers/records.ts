// Model call records (ARCH-060, PRV-054): one per call made for a campaign, holding every
// attempt, failed ones included, the messages, and the caller's prompt report (CTX-090).
// Records are stored in the campaign through storage, but are not commits (ARCH-061).
import type { AppError, ModelCallAttempt, ModelCallRecord, Result } from '@mythos/contracts';
import { type CampaignStore, insertModelCall } from '../storage';
import type { QueueLogger } from './queue';
import type { TextResponse } from './types';

/** What a finished call came to (03-contracts §14.1). */
export type CallOutcome = ModelCallRecord['outcome'];

/**
 * One attempt as the provider left it: its answer, or the error it got instead, with no
 * problems yet. Validation adds those to the same object (PRV-050 step 6).
 */
export function attemptOf(
  attempt: number,
  method: ModelCallAttempt['method'],
  result: Result<TextResponse, AppError>,
  durationMs: number,
): ModelCallAttempt {
  const problems = { parseError: null, schemaIssues: [], semanticIssues: [] };
  // A clock set back while the call ran would make the duration negative.
  const duration = Math.max(0, Math.round(durationMs));
  if (!result.ok) {
    const { code, message, details } = result.error;
    const error: AppError = details === undefined ? { code, message } : { code, message, details };
    return {
      attempt,
      method,
      rawOutput: '',
      thinking: null,
      error,
      ...problems,
      usage: null,
      durationMs: duration,
    };
  }
  const { text, thinking, usage } = result.value;
  return {
    attempt,
    method,
    rawOutput: text,
    thinking,
    error: null,
    ...problems,
    usage,
    durationMs: duration,
  };
}

/** The outcome of a call that ends with an error. */
export function errorOutcome(error: AppError): CallOutcome {
  return error.code === 'cancelled' ? 'cancelled' : 'failed';
}

/**
 * Stores a finished call's record in its campaign. A campaign that no longer opens, such
 * as one deleted while the call ran, is logged and its record dropped: the call's result
 * still reaches its caller. Implements ARCH-060 and PRV-054.
 */
export function writeRecord(
  campaigns: Pick<CampaignStore, 'openCampaign'>,
  logger: QueueLogger,
  record: ModelCallRecord,
): void {
  const opened = campaigns.openCampaign(record.campaignId);
  if (!opened.ok) {
    const fields = { campaignId: record.campaignId, callId: record.id, code: opened.error.code };
    logger.warn(fields, 'a model call record was not stored');
    return;
  }
  insertModelCall(opened.value, record);
}

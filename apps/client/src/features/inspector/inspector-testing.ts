// Model call records for the inspector's tests, parsed with the contract schema so they
// cannot drift from what the server stores (CTX-090, PRV-054).
import {
  ModelCallRecordSchema,
  type ModelCallRecord,
  type ModelCallSummary,
} from '@mythos/contracts';
import { campaignId } from '@/test/fixtures';

export const recordedCallId = '8b3e1d20-5c74-4f90-9c83-000000000001';
export const narrationCallId = '8b3e1d20-5c74-4f90-9c83-000000000002';

/**
 * An adjudicator call with four tiers and two attempts. The first, by JSON schema,
 * failed its schema and a semantic check; the second succeeded and showed its thinking.
 */
export function recordedCall(turnId: string): ModelCallRecord {
  return ModelCallRecordSchema.parse({
    id: recordedCallId,
    campaignId,
    turnId,
    role: 'adjudicator',
    providerId: 'ollama-local',
    profileId: 'qwen-32b',
    model: 'qwen2.5:32b-instruct-q4_K_M',
    messages: [
      { role: 'system', content: 'You are the GM of Brinemoor. Rule on the action.' },
      {
        role: 'system',
        content: 'The Gull and Anchor is a low tavern by the harbor.',
        cacheBreakpoint: true,
      },
      { role: 'user', content: 'I ask Varek what happened to the Merrow’s Luck.' },
    ],
    tiers: [
      { tier: 'instructions', budget: 900, estimatedTokens: 812, trimmed: [], cachedPrefix: true },
      { tier: 'world', budget: 1500, estimatedTokens: 1204, trimmed: [], cachedPrefix: true },
      {
        tier: 'transcript',
        budget: 4000,
        estimatedTokens: 3990,
        trimmed: ['turns 1 to 8, rolled into a summary'],
        cachedPrefix: true,
      },
      { tier: 'turn', budget: 300, estimatedTokens: 340, trimmed: [], cachedPrefix: false },
    ],
    retrieved: [],
    templates: ['engine:adjudicator.md'],
    attempts: [
      {
        attempt: 1,
        method: 'json-schema',
        rawOutput: '{"kind":"roll","stat":"charm"}',
        thinking: null,
        error: null,
        parseError: null,
        schemaIssues: ['stakes: expected an object'],
        semanticIssues: [{ path: 'stat', message: 'The ruleset has no stat "charm".' }],
        usage: { inputTokens: 6346, outputTokens: 21, cachedInputTokens: 4006 },
        durationMs: 2140,
      },
      {
        attempt: 2,
        method: 'json-schema',
        rawOutput: '{"kind":"direct","outcome":"success"}',
        thinking: 'Varek has no reason to hide this.',
        error: null,
        parseError: null,
        schemaIssues: [],
        semanticIssues: [],
        usage: { inputTokens: 6420, outputTokens: 18, cachedInputTokens: 6006 },
        durationMs: 1060,
      },
    ],
    outcome: 'success',
    createdAt: '2026-11-05T10:00:00Z',
  });
}

/** A narrator call whose first attempt timed out at the provider and whose second answered. */
export function narrationCall(turnId: string): ModelCallRecord {
  return ModelCallRecordSchema.parse({
    id: narrationCallId,
    campaignId,
    turnId,
    role: 'narrator',
    providerId: 'ollama-local',
    profileId: 'qwen-32b',
    model: 'qwen2.5:32b-instruct-q4_K_M',
    messages: [{ role: 'system', content: 'Narrate the outcome.' }],
    tiers: [
      { tier: 'instructions', budget: 900, estimatedTokens: 300, trimmed: [], cachedPrefix: true },
    ],
    retrieved: [],
    templates: ['engine:narrator.md'],
    attempts: [
      {
        attempt: 1,
        method: 'text',
        rawOutput: '',
        thinking: null,
        error: { code: 'provider_timeout', message: 'No answer within 60 seconds.' },
        parseError: null,
        schemaIssues: [],
        semanticIssues: [],
        usage: null,
        durationMs: 60_000,
      },
      {
        attempt: 2,
        method: 'text',
        rawOutput: 'Varek sets down his pen.',
        thinking: null,
        error: null,
        parseError: null,
        schemaIssues: [],
        semanticIssues: [],
        usage: null,
        durationMs: 850,
      },
    ],
    outcome: 'success',
    createdAt: '2026-11-05T10:00:05Z',
  });
}

/** A record as the call list gets it, summed as the server's `summaryOf` does. */
export function summaryOf(record: ModelCallRecord): ModelCallSummary {
  const last = record.attempts.at(-1);
  return {
    id: record.id,
    turnId: record.turnId,
    role: record.role,
    model: record.model,
    outcome: record.outcome,
    createdAt: record.createdAt,
    durationMs: record.attempts.reduce((total, attempt) => total + attempt.durationMs, 0),
    inputTokens: last?.usage?.inputTokens ?? null,
    outputTokens: last?.usage?.outputTokens ?? null,
    attempts: record.attempts.length,
  };
}

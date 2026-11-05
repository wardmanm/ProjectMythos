// Prompt budgets and transcript rolling (09-context §4, §5): how many tokens each tier
// of a prompt may use, and where the verbatim transcript starts.
import { err, ok, type Result, type Tier } from '@mythos/contracts';

/** Tiers that always get exactly what they need (CTX-031). */
const FIXED_TIERS: readonly Tier[] = ['instructions', 'world', 'turn', 'task'];

/** Where trimmable tiers' unused budget goes, in order (CTX-033). */
const SPILL_ORDER: readonly Tier[] = ['knowledge', 'transcript', 'state', 'scene'];

/**
 * One tier of a prompt to budget. `need` is the tokens its content would take. `weight`
 * and `cap` apply only to trimmable tiers: the tier's share of what the fixed tiers leave,
 * and the profile's `<role>.<tier>` limit, or null for none.
 */
export type TierSpec = { tier: Tier; need: number; weight: number; cap: number | null };

/** Each tier's token budget. Tiers not given to `allocateBudgets` are absent. */
export type TierBudgets = Partial<Record<Tier, number>>;

/** Why budgets could not be allocated: the fixed tiers alone exceed the input budget (CTX-032). */
export type BudgetOverflow = { fixedTiers: { tier: Tier; tokens: number }[]; available: number };

/**
 * A prompt's input budget: the context window less the output tokens, less 10% of what
 * remains as a margin for estimation error. Never negative. Implements CTX-030.
 */
export function inputBudget(contextWindow: number, maxOutputTokens: number): number {
  // Integer arithmetic, so the same profile always gives the same budget.
  return Math.max(0, Math.floor(((contextWindow - maxOutputTokens) * 9) / 10));
}

/**
 * Splits an input budget among a prompt's tiers. Fixed tiers get exactly their need;
 * trimmable tiers share the rest by weight, never above their need or cap, and what
 * they leave spills to knowledge, transcript, state, then scene. Fails when the fixed
 * tiers alone do not fit. Implements CTX-031, CTX-032, and CTX-033.
 */
export function allocateBudgets(
  totalInput: number,
  specs: readonly TierSpec[],
): Result<TierBudgets, BudgetOverflow> {
  const fixed = specs.filter((spec) => FIXED_TIERS.includes(spec.tier));
  const fixedNeed = fixed.reduce((sum, spec) => sum + spec.need, 0);
  if (fixedNeed > totalInput) {
    return err({
      fixedTiers: fixed.map((spec) => ({ tier: spec.tier, tokens: spec.need })),
      available: totalInput,
    });
  }

  const budgets: TierBudgets = {};
  for (const spec of fixed) budgets[spec.tier] = spec.need;

  const trimmable = specs.filter((spec) => !FIXED_TIERS.includes(spec.tier));
  // A cap limits only trimmable tiers; fixed tiers are never cut (owner's decision, CTX-031).
  const limit = (spec: TierSpec): number =>
    spec.cap === null ? spec.need : Math.min(spec.need, spec.cap);
  const remaining = totalInput - fixedNeed;
  const totalWeight = trimmable.reduce((sum, spec) => sum + spec.weight, 0);
  let unused = remaining;
  for (const spec of trimmable) {
    const share = totalWeight === 0 ? 0 : Math.floor((remaining * spec.weight) / totalWeight);
    const granted = Math.min(limit(spec), share);
    budgets[spec.tier] = granted;
    unused -= granted;
  }

  for (const tier of SPILL_ORDER) {
    const spec = trimmable.find((candidate) => candidate.tier === tier);
    if (spec === undefined || unused <= 0) continue;
    const current = budgets[tier] ?? 0;
    const extra = Math.min(unused, limit(spec) - current);
    budgets[tier] = current + extra;
    unused -= extra;
  }
  return ok(budgets);
}

/**
 * Splits a scene's turns into rolled chunks and a verbatim tail. The tail starts at the
 * earliest chunk boundary whose turns fit `budget`, so the prompt prefix stays
 * byte-identical between rolls. If even the newest chunk is too big, the tail is the
 * newest turns that fit, which may be none. Implements CTX-041.
 */
export function transcriptBoundary(
  turnTokens: readonly number[],
  budget: number,
  chunkTurns: number,
): { summarizedChunks: number; verbatimFrom: number } {
  const count = turnTokens.length;
  const tailTokens = (from: number): number =>
    turnTokens.slice(from).reduce((sum, tokens) => sum + tokens, 0);

  for (let boundary = 0; boundary < count; boundary += chunkTurns) {
    if (tailTokens(boundary) <= budget) {
      return { summarizedChunks: boundary / chunkTurns, verbatimFrom: boundary };
    }
  }
  // Even the newest chunk is too big: keep whatever newest turns fit. This moves the
  // boundary off a chunk edge, so the prefix is unstable, but it is rare.
  let from = count;
  while (from > 0 && tailTokens(from - 1) <= budget) from -= 1;
  return { summarizedChunks: Math.floor(from / chunkTurns), verbatimFrom: from };
}

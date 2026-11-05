import { TierSchema, type Tier } from '@mythos/contracts';
import { cmp } from './compare';

/** Prompt tiers, most stable first (CTX §3). */
export const TIERS = TierSchema.options;

// ============================================================ budget allocation (CTX §4)

export type TierSpec = { tier: Tier; share: number; fixed: boolean; desired: number };
const SPILL_ORDER: Tier[] = ['knowledge', 'transcript', 'state', 'scene'];

export function allocateBudgets(totalInput: number, specs: TierSpec[]):
  { ok: true; budgets: Record<string, number> } | { ok: false; overflow: { tier: Tier; tokens: number }[]; available: number } {
  const fixed = specs.filter((s) => s.fixed);
  const fixedNeed = fixed.reduce((a, s) => a + s.desired, 0);
  if (fixedNeed > totalInput) return { ok: false, overflow: fixed.map((s) => ({ tier: s.tier, tokens: s.desired })), available: totalInput };
  const budgets: Record<string, number> = Object.fromEntries(fixed.map((s) => [s.tier, s.desired]));
  const trimmable = specs.filter((s) => !s.fixed);
  const remaining = totalInput - fixedNeed;
  const shareSum = trimmable.reduce((a, s) => a + s.share, 0) || 1;
  let pool = remaining;
  for (const s of trimmable) {
    const granted = Math.min(s.desired, Math.floor((remaining * s.share) / shareSum));
    budgets[s.tier] = granted;
    pool -= granted;
  }
  // Unused budget spills to the tiers that can use it most (CTX-033).
  for (const t of SPILL_ORDER) {
    const s = trimmable.find((x) => x.tier === t);
    if (!s || pool <= 0) continue;
    const extra = Math.min(pool, s.desired - (budgets[t] ?? 0));
    budgets[t] = (budgets[t] ?? 0) + extra;
    pool -= extra;
  }
  return { ok: true, budgets };
}

// ============================================================ key speakers (CTX §6)

export type SpeakerCandidate = {
  id: string;
  flagged: boolean; // keyNpc on the character
  involved: boolean; // addressed or named in the input, targeted by the ruling, or spoke last turn
  secretImportance: number; // highest importance among retrieved memories the PC does not know; 0 if none
};

export function selectKeySpeakers(cands: SpeakerCandidate[], mode: 'shared' | 'key' | 'strict', max: number, threshold: number): string[] {
  if (mode === 'shared' || max === 0) return [];
  const eligible = cands.filter((c) => c.involved && (mode === 'strict' || c.flagged || c.secretImportance >= threshold));
  return eligible
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.secretImportance - a.secretImportance || cmp(a.id, b.id))
    .slice(0, max)
    .map((c) => c.id);
}

// ============================================================ transcript windows (CTX §5)

/**
 * Splits a scene's turns into a summarized head and a verbatim tail. The boundary only
 * moves in whole chunks of `chunk` turns, so the prompt prefix stays byte-identical
 * between moves and the model's cache keeps working (CTX-041).
 */
export function transcriptBoundary(turnTokens: number[], budget: number, chunk: number): { summarizedChunks: number; verbatimFrom: number } {
  const n = turnTokens.length;
  const tail = (from: number) => turnTokens.slice(from).reduce((a, b) => a + b, 0);
  for (let b = 0; b < n; b += chunk) if (tail(b) <= budget) return { summarizedChunks: b / chunk, verbatimFrom: b };
  // Even the newest chunk is too big: keep whatever newest turns fit, perhaps none. Unstable, but rare.
  let from = n;
  while (from > 0 && tail(from - 1) <= budget) from--;
  return { summarizedChunks: Math.floor(from / chunk), verbatimFrom: from };
}

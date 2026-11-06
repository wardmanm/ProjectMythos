import type { Tier } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import {
  allocateBudgets,
  estimateTokens,
  inputBudget,
  type TierBudgets,
  type TierSpec,
  transcriptBoundary,
} from './context';

type Needs = Partial<Record<Tier, number>>;
type Caps = Partial<Record<Tier, number>>;

// The narrator-like spec from the reference tests: weights 12, 32, 6, 20 among the
// trimmable tiers.
const specs = (needs: Needs = {}, caps: Caps = {}): TierSpec[] => {
  const spec = (tier: Tier, need: number, weight: number): TierSpec => ({
    tier,
    need: needs[tier] ?? need,
    weight,
    cap: caps[tier] ?? null,
  });
  return [
    spec('instructions', 3000, 0),
    spec('world', 1000, 0),
    spec('scene', 2000, 12),
    spec('transcript', 20000, 32),
    spec('state', 800, 6),
    spec('knowledge', 9000, 20),
    spec('turn', 600, 0),
    spec('task', 200, 0),
  ];
};

const budgetsOf = (total: number, given: TierSpec[]): TierBudgets => {
  const result = allocateBudgets(total, given);
  if (!result.ok) throw new Error('expected budgets, got an overflow');
  return result.value;
};
const sum = (budgets: TierBudgets): number =>
  Object.values(budgets).reduce((total, tokens) => total + tokens, 0);

describe('estimateTokens', () => {
  it('PRV-070: tokens are characters divided by the ratio, rounded up', () => {
    expect(estimateTokens('', 3.5)).toBe(0);
    expect(estimateTokens('abcdefgh', 4)).toBe(2);
    expect(estimateTokens('abcdefghi', 4)).toBe(3);
    expect(estimateTokens('abcdefgh', 3.5)).toBe(3);
  });
});

describe('inputBudget', () => {
  it('CTX-030: the window less output tokens, less a 10% margin on what remains', () => {
    expect(inputBudget(32768, 2048)).toBe(27648);
    expect(inputBudget(8192, 1024)).toBe(6451);
  });

  it('CTX-030: never negative when the output takes the whole window', () => {
    expect(inputBudget(4096, 8192)).toBe(0);
  });
});

describe('allocateBudgets', () => {
  it('CTX-031, CTX-100: fixed tiers get exactly what they need', () => {
    const budgets = budgetsOf(20000, specs());
    expect([budgets.instructions, budgets.world, budgets.turn, budgets.task]).toEqual([
      3000, 1000, 600, 200,
    ]);
  });

  it('CTX-031, CTX-033, CTX-100: small tiers take only what they need; the rest spills to knowledge first', () => {
    // 15200 left after fixed tiers. By weight, transcript gets 6948 and knowledge 4342;
    // scene and state need only 2000 and 800 of their shares, and the 1110 left spills
    // to knowledge.
    const budgets = budgetsOf(20000, specs());
    expect([budgets.scene, budgets.transcript, budgets.state, budgets.knowledge]).toEqual([
      2000,
      6948,
      800,
      4342 + 1110,
    ]);
    expect(sum(budgets)).toBe(20000);
  });

  it('CTX-033, CTX-100: once knowledge is full, the spill goes to transcript, then state, then scene', () => {
    // 6000 left after fixed tiers: shares are 1028 scene, 2742 transcript, 514 state,
    // 1714 knowledge (2 tokens lost to rounding).
    const toTranscript = budgetsOf(10800, specs({ knowledge: 100 }));
    expect(toTranscript.knowledge).toBe(100);
    expect(toTranscript.transcript).toBe(2742 + 1614 + 2);
    const toState = budgetsOf(10800, specs({ knowledge: 100, transcript: 100 }));
    expect(toState.state).toBe(800);
    expect(toState.scene).toBe(2000);
    expect(sum(toState)).toBe(4800 + 100 + 100 + 800 + 2000);
  });

  it('CTX-033, CTX-100: when every tier is satisfied, the unused budget is simply left over', () => {
    const budgets = budgetsOf(100000, specs());
    expect([budgets.scene, budgets.transcript, budgets.state, budgets.knowledge]).toEqual([
      2000, 20000, 800, 9000,
    ]);
  });

  it('CTX-031, CTX-100: a profile cap limits a trimmable tier, and its share spills elsewhere', () => {
    const budgets = budgetsOf(20000, specs({}, { transcript: 3000 }));
    expect(budgets.transcript).toBe(3000);
    expect(budgets.knowledge).toBe(9000);
    expect(sum(budgets)).toBe(4800 + 2000 + 3000 + 800 + 9000);
  });

  it('CTX-031, CTX-100: a cap on a fixed tier has no effect', () => {
    const budgets = budgetsOf(20000, specs({}, { instructions: 1000, turn: 100 }));
    expect([budgets.instructions, budgets.turn]).toEqual([3000, 600]);
  });

  it('CTX-032, CTX-100: fixed tiers too big for the budget report every fixed tier and its size', () => {
    expect(allocateBudgets(4000, specs())).toEqual({
      ok: false,
      error: {
        fixedTiers: [
          { tier: 'instructions', tokens: 3000 },
          { tier: 'world', tokens: 1000 },
          { tier: 'turn', tokens: 600 },
          { tier: 'task', tokens: 200 },
        ],
        available: 4000,
      },
    });
  });

  it('CTX-031: a role without some tiers, or with no weights, still gets its fixed tiers', () => {
    const voice: TierSpec[] = [
      { tier: 'instructions', need: 500, weight: 0, cap: null },
      { tier: 'knowledge', need: 900, weight: 0, cap: null },
      { tier: 'task', need: 100, weight: 0, cap: null },
    ];
    expect(budgetsOf(1000, voice)).toEqual({ instructions: 500, knowledge: 400, task: 100 });
  });
});

describe('transcriptBoundary', () => {
  it('CTX-041: over 60 turns the tail stays in budget, starts on a chunk edge, and the prefix changes only when a chunk rolls', () => {
    const tokens: number[] = [];
    const problems: string[] = [];
    let previous: string | null = null;
    let prefixChanges = 0;
    for (let turn = 0; turn < 60; turn += 1) {
      tokens.push(250 + ((turn * 37) % 100));
      const boundary = transcriptBoundary(tokens, 4000, 8);
      // What precedes the verbatim tail; it must stay the same between rolls.
      const prefix = `${String(boundary.summarizedChunks)}|${String(boundary.verbatimFrom)}`;
      if (previous !== null && prefix !== previous) prefixChanges += 1;
      previous = prefix;
      const tail = tokens.slice(boundary.verbatimFrom).reduce((total, n) => total + n, 0);
      if (tail > 4000) problems.push(`tail over budget at turn ${String(turn)}`);
      if (boundary.verbatimFrom % 8 !== 0)
        problems.push(`off a chunk edge at turn ${String(turn)}`);
    }
    expect(problems).toEqual([]);
    expect(prefixChanges).toBe(6);
  });

  it('CTX-041: a short scene is all verbatim', () => {
    expect(transcriptBoundary([300, 300, 300], 4000, 8)).toEqual({
      summarizedChunks: 0,
      verbatimFrom: 0,
    });
  });

  it('CTX-041: an oversized newest chunk falls back to the newest turns that fit', () => {
    expect(transcriptBoundary([100, 100, 5000, 100], 300, 8)).toEqual({
      summarizedChunks: 0,
      verbatimFrom: 3,
    });
  });

  it('CTX-041: when not even the newest turn fits, the tail is empty', () => {
    expect(transcriptBoundary([100, 5000], 300, 8)).toEqual({
      summarizedChunks: 0,
      verbatimFrom: 2,
    });
  });

  it('CTX-041: an empty transcript has nothing to roll', () => {
    expect(transcriptBoundary([], 300, 8)).toEqual({ summarizedChunks: 0, verbatimFrom: 0 });
  });
});

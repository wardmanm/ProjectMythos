// Fitting a prompt to its model (09-context §4, §5): budgets for each tier, the scene
// trimmed and the transcript rolled until they fit, and the PRV-072 check on the result.
import {
  type AppError,
  type ChatMessage,
  err,
  type ModelProfile,
  type ModelRole,
  ok,
  type Result,
  type Tier,
  type TierReport,
} from '@mythos/contracts';
import {
  allocateBudgets,
  estimateTokens,
  inputBudget,
  type TierBudgets,
  type TierSpec,
  transcriptBoundary,
} from '@mythos/core';
import { type Layout, layOut, tierReports, type TierTexts } from './tiers';

/**
 * What to render: how many of the scene's trims to apply, in order, and which of the
 * scene's transcript turns to include, `from` up to but not including `to`.
 */
export type FitChoice = { sceneTrims: number; transcript: { from: number; to: number } };

export type FitInput = {
  role: ModelRole;
  /** The recipe's tiers, in order. */
  tiers: readonly Tier[];
  /** The trimmable tiers' weights (CTX-033); every other tier is fixed. */
  weights: { scene: number; transcript: number };
  profile: ModelProfile;
  charsPerToken: number;
  /** Tokens kept back for what the caller adds after this, such as a format instruction. */
  reservedTokens: number;
  /** What each scene trim leaves out, for the inspector, in the order they apply (CTX-034). */
  sceneTrims: readonly string[];
  transcriptTurns: number;
  chunkTurns: number;
  /** The prompt's tiers for a choice, locked content included. */
  render(choice: FitChoice): Result<TierTexts, AppError>;
};

export type FittedPrompt = { messages: ChatMessage[]; tiers: TierReport[] };

/** A tier in an overflow message, with what it holds if that needs saying. */
type Row = { tier: Tier; tokens: number; note: string | null };

const rowOf = ({ tier, tokens }: { tier: Tier; tokens: number }): Row => ({
  tier,
  tokens,
  note: null,
});

/**
 * `context_overflow`: what did not fit, each tier in `rows` with its size, and the
 * reservation on a line of its own. Implements CTX-032.
 */
function overflow(input: FitInput, what: string, rows: readonly Row[]): AppError {
  const { profile, role } = input;
  const budget = inputBudget(profile.contextWindow, profile.maxOutputTokens);
  const needed = rows.reduce((sum, row) => sum + row.tokens, input.reservedTokens);
  const lines = [
    ...rows.map(
      (row) =>
        `- ${row.tier}${row.note === null ? '' : ` (${row.note})`}: ${String(row.tokens)} tokens`,
    ),
    `- reserved for the format instruction: ${String(input.reservedTokens)} tokens`,
  ];
  const message =
    `The ${role} prompt does not fit model profile "${profile.id}". A ` +
    `${String(profile.contextWindow)}-token context window, less ${String(profile.maxOutputTokens)} ` +
    `output tokens and a 10% margin, leaves ${String(budget)} tokens for input, and ${what} ` +
    `need ${String(needed)}:\n${lines.join('\n')}\n` +
    'Use a model profile with a larger context window or fewer output tokens.';
  return {
    code: 'context_overflow',
    message,
    details: {
      tiers: rows.map((row) => ({ tier: row.tier, tokens: row.tokens })),
      reservedTokens: input.reservedTokens,
      inputBudget: budget,
    },
  };
}

function specs(input: FitInput, layout: Layout, without: readonly Tier[] = []): TierSpec[] {
  const capOf = (tier: Tier) => input.profile.contextBudget[`${input.role}.${tier}`] ?? null;
  return input.tiers
    .filter((tier) => !without.includes(tier))
    .map((tier) => {
      const need = layout.tokens[tier] ?? 0;
      const weight = tier === 'scene' || tier === 'transcript' ? input.weights[tier] : null;
      return weight === null
        ? { tier, need, weight: 0, cap: null }
        : { tier, need, weight, cap: capOf(tier) };
    });
}

type Rendered = { choice: FitChoice; texts: TierTexts; layout: Layout };

function render(input: FitInput, choice: FitChoice): Result<Rendered, AppError> {
  const texts = input.render(choice);
  if (!texts.ok) return texts;
  return ok({ choice, texts: texts.value, layout: layOut(texts.value, input.charsPerToken) });
}

/**
 * Trims the scene one step at a time until it fits `budget`, or every trim is applied.
 * Implements CTX-034's scene row.
 */
function trimScene(input: FitInput, start: Rendered, budget: number): Result<Rendered, AppError> {
  let current = start;
  while (
    (current.layout.tokens.scene ?? 0) > budget &&
    current.choice.sceneTrims < input.sceneTrims.length
  ) {
    const next = render(input, { ...current.choice, sceneTrims: current.choice.sceneTrims + 1 });
    if (!next.ok) return next;
    current = next.value;
  }
  return ok(current);
}

/** Where the verbatim tail may start next, when the tail starting at `from` is too big. */
function nextStart(from: number, chunkTurns: number, turns: number): number {
  const nextBoundary = from + chunkTurns - (from % chunkTurns);
  // Past the newest boundary the tail shrinks one turn at a time (CTX-041).
  return nextBoundary < turns && from % chunkTurns === 0 ? nextBoundary : from + 1;
}

/**
 * Rolls the transcript by whole chunks until its tail fits `budget`. Each turn is first
 * estimated alone, for `transcriptBoundary`; the tail it picks is then rendered and
 * checked, and rolled again if a template made it bigger. Implements CTX-041.
 */
function rollTranscript(
  input: FitInput,
  start: Rendered,
  budget: number,
): Result<Rendered, AppError> {
  const turns = input.transcriptTurns;
  if ((start.layout.tokens.transcript ?? 0) <= budget) return ok(start);
  const turnTokens: number[] = [];
  for (let index = 0; index < turns; index += 1) {
    const alone = render(input, { ...start.choice, transcript: { from: index, to: index + 1 } });
    if (!alone.ok) return alone;
    turnTokens.push(alone.value.layout.tokens.transcript ?? 0);
  }
  let from = transcriptBoundary(turnTokens, budget, input.chunkTurns).verbatimFrom;
  for (;;) {
    const tail = render(input, { ...start.choice, transcript: { from, to: turns } });
    if (!tail.ok) return tail;
    if ((tail.value.layout.tokens.transcript ?? 0) <= budget || from >= turns) return tail;
    from = nextStart(from, input.chunkTurns, turns);
  }
}

/** The scene, trimmed to fit, and every tier's budget. */
type Allocated = { rendered: Rendered; budgets: TierBudgets };

/**
 * Splits the input budget among the tiers and trims the scene to its share. A scene still
 * over its share at its last trim is kept whole, like a fixed tier, and the transcript
 * makes up the difference (owner's decision). Implements CTX-031 to CTX-034.
 */
function allocate(
  input: FitInput,
  first: Rendered,
  available: number,
): Result<Allocated, AppError> {
  const allocated = allocateBudgets(available, specs(input, first.layout));
  if (!allocated.ok) {
    return err(overflow(input, 'the fixed tiers', allocated.error.fixedTiers.map(rowOf)));
  }
  const budgets = allocated.value;
  const trimmed = trimScene(input, first, budgets.scene ?? 0);
  if (!trimmed.ok) return trimmed;
  const sceneTokens = trimmed.value.layout.tokens.scene ?? 0;
  if (sceneTokens <= (budgets.scene ?? 0)) return ok({ rendered: trimmed.value, budgets });

  const rest = allocateBudgets(
    available - sceneTokens,
    specs(input, trimmed.value.layout, ['scene']),
  );
  if (!rest.ok) {
    const rows = [
      ...rest.error.fixedTiers.map(rowOf),
      { tier: 'scene' as const, tokens: sceneTokens, note: 'fully trimmed' },
    ];
    return err(overflow(input, 'the fixed tiers and the trimmed scene', rows));
  }
  return ok({ rendered: trimmed.value, budgets: { ...rest.value, scene: sceneTokens } });
}

/** What the inspector shows was left out (CTX-034, CTX-043). */
function trimmedItems(input: FitInput, choice: FitChoice): Partial<Record<Tier, string[]>> {
  const rolledOut = choice.transcript.from;
  const turns = `${String(rolledOut)} turn${rolledOut === 1 ? '' : 's'}`;
  return {
    scene: input.sceneTrims.slice(0, choice.sceneTrims),
    // Rolled turns are left out until chunk summaries arrive in phase 2 (09-context §11).
    transcript: rolledOut === 0 ? [] : [`the scene's first ${turns} (no summary yet)`],
  };
}

/**
 * Builds the prompt that fits the profile: fixed tiers whole, the scene and transcript
 * within their shares, and the whole estimate plus the reservation plus the output tokens
 * within the context window. Fails with `context_overflow` when the fixed tiers alone do
 * not fit. Implements CTX-030 to CTX-034, CTX-041, and PRV-072.
 */
export function fitPrompt(input: FitInput): Result<FittedPrompt, AppError> {
  const { profile } = input;
  // Implements the owner's decision on CTX-030: the reservation comes off first.
  const available = Math.max(
    0,
    inputBudget(profile.contextWindow, profile.maxOutputTokens) - input.reservedTokens,
  );
  const everything = { from: 0, to: input.transcriptTurns };
  const first = render(input, { sceneTrims: 0, transcript: everything });
  if (!first.ok) return first;
  const allocated = allocate(input, first.value, available);
  if (!allocated.ok) return allocated;
  const { budgets } = allocated.value;
  const rolled = rollTranscript(input, allocated.value.rendered, budgets.transcript ?? 0);
  if (!rolled.ok) return rolled;
  const { choice, layout } = rolled.value;

  // Implements PRV-072, with the estimate calibration uses: over all the text sent.
  const sent = layout.messages.map((message) => message.content).join('');
  const total = estimateTokens(sent, input.charsPerToken);
  if (total + input.reservedTokens + profile.maxOutputTokens > profile.contextWindow) {
    const rows = input.tiers.map((tier) => rowOf({ tier, tokens: layout.tokens[tier] ?? 0 }));
    return err(overflow(input, 'the trimmed prompt and its reservation', rows));
  }
  // Fixed tiers are reported at what they took; trimmable ones at their budget.
  const trimmableBudgets: Partial<Record<Tier, number>> = {};
  for (const tier of ['scene', 'transcript'] as const) {
    const budget = budgets[tier];
    if (budget !== undefined) trimmableBudgets[tier] = budget;
  }
  const tiers = tierReports(input.tiers, layout, trimmableBudgets, trimmedItems(input, choice));
  return ok({ messages: layout.messages, tiers });
}

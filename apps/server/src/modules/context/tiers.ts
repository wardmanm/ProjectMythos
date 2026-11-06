// A prompt's tiers (09-context §3): where each starts in a rendered template, the locked
// content code adds, the messages they are laid out in, and what the inspector reports.
import {
  type ChatMessage,
  err,
  type ModelRole,
  ok,
  type Result,
  type Tier,
  type TierReport,
} from '@mythos/contracts';
import { appendFloorToTask, appendLocked, estimateTokens } from '@mythos/core';

/** Each tier's text, trimmed; an empty or absent tier has no content. */
export type TierTexts = Partial<Record<Tier, string>>;

/** A marker line, `<!-- tier: world -->` (CTX-003). */
const MARKER = /^<!--\s*tier:\s*(.*?)\s*-->$/;

/**
 * Splits a rendered top-level template at its tier markers. Each of `tiers` must start
 * once, in order, with nothing but blank lines before the first. Returns each tier's
 * text, trimmed, or what is wrong with the markers. Implements CTX-003.
 */
export function splitTiers(rendered: string, tiers: readonly Tier[]): Result<TierTexts, string> {
  const linesOf = new Map<Tier, string[]>();
  // Lines before the first marker, then each tier's lines after its marker.
  const before: string[] = [];
  let current = before;
  let last: Tier | null = null;
  for (const line of rendered.split('\n')) {
    const marker = MARKER.exec(line.trim());
    if (marker === null) {
      current.push(line);
      continue;
    }
    const name = marker[1] ?? '';
    const tier = tiers.find((each) => each === name);
    if (tier === undefined) {
      return err(`"${name}" is not a tier of this prompt; its tiers are ${tiers.join(', ')}`);
    }
    if (linesOf.has(tier)) return err(`the ${tier} tier starts twice`);
    if (last !== null && tiers.indexOf(tier) < tiers.indexOf(last)) {
      return err(`the ${tier} tier starts after the ${last} tier; tiers go ${tiers.join(', ')}`);
    }
    current = [];
    linesOf.set(tier, current);
    last = tier;
  }
  const missing = tiers.filter((tier) => !linesOf.has(tier));
  if (missing.length > 0) {
    return err(`no marker starts the ${missing.join(', ')} tier (<!-- tier: name -->)`);
  }
  if (before.join('').trim() !== '') return err('there is text before the first tier marker');
  const texts: TierTexts = {};
  for (const [tier, lines] of linesOf) texts[tier] = lines.join('\n').trim();
  return ok(texts);
}

/**
 * Adds the locked content no template can change: the hard floor at the end of the
 * instructions tier, and again at the end of the task tier while a minor is present or
 * involved, both through core. Implements CTX-007, CSET-040, and CSET-042.
 */
export function withLockedContent(texts: TierTexts, role: ModelRole, minor: boolean): TierTexts {
  return {
    ...texts,
    instructions: appendLocked(texts.instructions ?? '', role),
    task: appendFloorToTask(texts.task ?? '', role, minor),
  };
}

/** Each message of a prompt and its tiers, most stable first. Implements CTX-010. */
const MESSAGE_LAYOUT: readonly {
  role: ChatMessage['role'];
  tiers: readonly Tier[];
  cacheBreakpoint: boolean;
}[] = [
  { role: 'system', tiers: ['instructions'], cacheBreakpoint: false },
  { role: 'system', tiers: ['world'], cacheBreakpoint: true },
  { role: 'user', tiers: ['scene'], cacheBreakpoint: true },
  { role: 'user', tiers: ['transcript'], cacheBreakpoint: true },
  { role: 'user', tiers: ['state', 'knowledge', 'turn', 'task'], cacheBreakpoint: false },
];

/** Between two tiers that share a message. */
const TIER_SEPARATOR = '\n\n';

/** The messages, and how many tokens each tier adds to them, separators included. */
export type Layout = {
  messages: ChatMessage[];
  tokens: Partial<Record<Tier, number>>;
  /** Tiers whose message ends at or before the last cache breakpoint. */
  cached: Set<Tier>;
};

/**
 * Lays tiers out in CTX-010's messages. A tier with no content adds nothing, and a
 * message with no content is left out. Each tier is estimated with the separator before
 * it, so the tiers' estimates add up to at least the estimate of the whole prompt
 * (PRV-072). Implements CTX-010.
 */
export function layOut(texts: TierTexts, charsPerToken: number): Layout {
  const layout: Layout = { messages: [], tokens: {}, cached: new Set() };
  const tiersByMessage: Tier[][] = [];
  for (const group of MESSAGE_LAYOUT) {
    const present = group.tiers.filter((tier) => (texts[tier] ?? '') !== '');
    if (present.length === 0) continue;
    const parts = present.map((tier) => texts[tier] ?? '');
    present.forEach((tier, index) => {
      const counted = (index === 0 ? '' : TIER_SEPARATOR) + (texts[tier] ?? '');
      layout.tokens[tier] = estimateTokens(counted, charsPerToken);
    });
    const content = parts.join(TIER_SEPARATOR);
    layout.messages.push(
      group.cacheBreakpoint
        ? { role: group.role, content, cacheBreakpoint: true }
        : { role: group.role, content },
    );
    tiersByMessage.push(present);
  }
  const lastBreakpoint = layout.messages.findLastIndex((message) => message.cacheBreakpoint);
  for (const tier of tiersByMessage.slice(0, lastBreakpoint + 1).flat()) layout.cached.add(tier);
  return layout;
}

/**
 * One report per tier of the recipe, in order: its budget, its estimate, what was left
 * out to fit, and whether it is in the cached prefix. Implements CTX-090.
 */
export function tierReports(
  tiers: readonly Tier[],
  layout: Layout,
  budgets: Partial<Record<Tier, number>>,
  trimmed: Partial<Record<Tier, string[]>>,
): TierReport[] {
  return tiers.map((tier) => {
    const estimatedTokens = layout.tokens[tier] ?? 0;
    return {
      tier,
      budget: budgets[tier] ?? estimatedTokens,
      estimatedTokens,
      trimmed: trimmed[tier] ?? [],
      cachedPrefix: layout.cached.has(tier),
    };
  });
}

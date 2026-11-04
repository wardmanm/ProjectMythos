import { allocateBudgets, selectKeySpeakers, transcriptBoundary, type TierSpec } from './context';
import { eq } from '../test-support/harness';

// ---- budgets
const specs = (over: Partial<Record<string, number>> = {}): TierSpec[] => [
  { tier: 'instructions', share: 0, fixed: true, desired: over.instructions ?? 3000 },
  { tier: 'world', share: 0, fixed: true, desired: 1000 },
  { tier: 'scene', share: 12, fixed: false, desired: over.scene ?? 2000 },
  { tier: 'transcript', share: 32, fixed: false, desired: over.transcript ?? 20000 },
  { tier: 'state', share: 6, fixed: false, desired: 800 },
  { tier: 'knowledge', share: 20, fixed: false, desired: over.knowledge ?? 9000 },
  { tier: 'turn', share: 0, fixed: true, desired: 600 },
  { tier: 'task', share: 0, fixed: true, desired: 200 },
];
const r = allocateBudgets(20000, specs());
eq('fixed tiers get exactly what they need', r.ok && [r.budgets.instructions, r.budgets.turn], [3000, 600]);
eq('budgets never exceed the total', r.ok && Object.values(r.budgets).reduce((a, b) => a + b, 0) <= 20000, true);
// 15200 left after fixed tiers. Shares give transcript 6948 and knowledge 4342; scene and
// state need only 2000 and 800 of theirs, and the 1110 left over spills to knowledge first.
eq('small tiers take only what they need; the rest spills to knowledge first',
  r.ok && [r.budgets.scene, r.budgets.state, r.budgets.knowledge, r.budgets.transcript], [2000, 800, 4342 + 1110, 6948]);
eq('nothing wasted when content exceeds the budget', r.ok && Object.values(r.budgets).reduce((a, b) => a + b, 0), 20000);
const big = allocateBudgets(100000, specs());
eq('large context: every tier gets everything it wants', big.ok && [big.budgets.transcript, big.budgets.knowledge], [20000, 9000]);
const tight = allocateBudgets(4000, specs());
eq('fixed tiers too big: overflow reported, not truncated', tight.ok ? 'ok' : tight.overflow.map((o) => o.tier), ['instructions', 'world', 'turn', 'task']);

// ---- key speakers
const c = [
  { id: 'npc.odette', flagged: false, involved: true, secretImportance: 3 },
  { id: 'npc.varek', flagged: false, involved: true, secretImportance: 10 },
  { id: 'npc.bartender', flagged: false, involved: false, secretImportance: 9 },
  { id: 'npc.tomas', flagged: true, involved: true, secretImportance: 0 },
];
eq('key mode: flagged first, then NPCs with relevant secrets; uninvolved never', selectKeySpeakers(c, 'key', 2, 7), ['npc.tomas', 'npc.varek']);
eq('key mode respects the cap', selectKeySpeakers(c, 'key', 1, 7), ['npc.tomas']);
eq('strict mode: every involved NPC', selectKeySpeakers(c, 'strict', 6, 7), ['npc.tomas', 'npc.varek', 'npc.odette']);
eq('shared mode: nobody', selectKeySpeakers(c, 'shared', 6, 7), []);

// ---- transcript stability: append 60 turns of ~300 tokens with a 4000-token verbatim budget
const tokens: number[] = [];
let prefixChanges = 0, prev: string | null = null;
const loopProblems: string[] = [];
for (let i = 0; i < 60; i++) {
  tokens.push(250 + ((i * 37) % 100));
  const b = transcriptBoundary(tokens, 4000, 8);
  const prefix = `${b.summarizedChunks}|${b.verbatimFrom}`; // what precedes the verbatim tail
  if (prev !== null && prefix !== prev) prefixChanges++;
  prev = prefix;
  const tail = tokens.slice(b.verbatimFrom).reduce((a, x) => a + x, 0);
  if (tail > 4000) loopProblems.push(`verbatim tail over budget at turn ${i}`);
  if (b.verbatimFrom % 8 !== 0) loopProblems.push(`boundary not on a chunk edge at turn ${i}`);
}
eq('over 60 turns, the verbatim tail stays in budget and starts on a chunk edge', loopProblems, []);
eq('over 60 turns, the cached prefix changes only when a whole chunk rolls (6 times)', prefixChanges, 6);
eq('oversized newest chunk falls back to what fits', transcriptBoundary([100, 100, 5000, 100], 300, 8), { summarizedChunks: 0, verbatimFrom: 3 });

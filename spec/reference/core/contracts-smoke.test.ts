import { randomUUID as u } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CommitPayloadSchema, CreateCampaignCommandSchema, EditStageCommandSchema, ResolutionDraftSchema, ResolveCommandSchema, RulingSchema, SECRET_PLACEHOLDER, SecretSchema, ServerEventSchema, SetPinCommandSchema } from '@mythos/contracts';
import { RulesetSchema } from '@mythos/contracts/content';
import { actionRoll, resistanceRoll, type Rng } from './rules';
import { eq, fixturePath } from '../test-support/harness';

// Smoke tests for the turn-engine contracts (06-turn-engine).
const g = { branchId: u(), expectedHeadTurnId: u() };
eq('ruling without elapsedMinutes is rejected', RulingSchema.safeParse({ kind: 'ooc', reply: 'hi' }).success, false);
eq('an OOC ruling can skip to morning', RulingSchema.safeParse({ kind: 'ooc', reply: 'Morning comes.', elapsedMinutes: 480 }).success, true);
eq('resolve: set-outcome', ResolveCommandSchema.safeParse({ ...g, turnId: u(), action: { action: 'set-outcome', outcome: 'success' } }).success, true);
const edit = EditStageCommandSchema.safeParse({ ...g, turnId: u(), edit: { stage: 'narration', text: 'Revised.' }, historyMode: 'retcon' });
eq('edit narration in retcon mode', edit.success, true);
eq('regenerateDownstream defaults to true', edit.success && edit.data.regenerateDownstream, true);
const ruleset = RulesetSchema.parse(JSON.parse(readFileSync(fixturePath('library/rulesets/ruleset.standard.json'), 'utf8')));
const dice = (...d: number[]): Rng => { let i = 0; return { roll: () => d[i++] ?? 1 }; };
const roll = actionRoll({ stat: 'str', rating: 2, difficulty: -1, itemBonuses: [], statuses: [], effectModifier: 0, ruleset, rng: dice(5) });
const resist = resistanceRoll('end', 3, ruleset, dice(2, 6, 4));
const draft = {
  turnId: u(), rulingSetId: u(), actionRoll: roll, outcome: roll.result, effect: 'limited',
  consequences: [{ type: 'harm', targetId: 'pc.wren', description: 'Wrenched wrist', harm: { level: 1, name: 'Wrenched Wrist', tags: ['physical'] } }],
  resistanceRolls: [{ consequenceIndex: 0, roll: resist, levelsReduced: 1, resultingLevel: null }],
  harmResults: [], clockResults: [], statChanges: [], healing: [], invalidConsequences: [],
  elapsedMinutes: 5, overridden: false, requiresResponse: true,
};
const parsed = ResolutionDraftSchema.safeParse(draft);
eq('a resolution draft built from engine rolls parses', parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.')), []);
eq('resolution.ready event', ServerEventSchema.safeParse({ id: 7, campaignId: u(), payload: { type: 'resolution.ready', draft } }).success, true);
eq('relationship.set', CommitPayloadSchema.safeParse({ type: 'relationship.set', fromId: 'npc.odette', toId: 'npc.varek', dimensions: { trust: 5 }, summary: 'Old friends.' }).success, true);
eq('relationship.adjust parses; the per-turn cap is a ruleset check, not a schema rule', CommitPayloadSchema.safeParse({ type: 'relationship.adjust', fromId: 'npc.odette', toId: 'npc.varek', deltas: { trust: 2 }, summary: null, addKeyObservationIds: [] }).success, true);

// Application API (03-contracts §14)
const create = { name: 'First visit', packId: 'reference', scenarioId: 'scenario.arrival', toneProfileId: 'tone.coastal-mystery', rulesetId: 'ruleset.standard' };
eq('create campaign with the premade PC; conversion defaults to null', CreateCampaignCommandSchema.parse({ ...create, pc: { mode: 'premade' } }).conversion, null);
eq('create campaign with a created PC', CreateCampaignCommandSchema.safeParse({ ...create, pc: { mode: 'created', name: 'Ada Fenn', ageCategory: 'adult', stats: { str: 3, end: 3, dex: 3, int: 3, cha: 3 }, physicalDescription: 'Tall.', personality: 'Wry and patient.' } }).success, true);
eq('a created PC needs an age category', CreateCampaignCommandSchema.safeParse({ ...create, pc: { mode: 'created', name: 'Ada', stats: {}, physicalDescription: '', personality: 'x' } }).success, false);
eq('the secret placeholder is itself a valid inline secret, so redacted configs still parse', SecretSchema.safeParse({ value: SECRET_PLACEHOLDER }).success, true);
eq('PINs are 4 to 12 digits', ['123', '1234', '12345678901234', 'abcd'].map((pin) => SetPinCommandSchema.safeParse({ pin }).success), [false, true, false, false]);

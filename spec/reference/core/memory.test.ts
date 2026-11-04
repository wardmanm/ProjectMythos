import { readFileSync } from 'node:fs';
import { RulesetSchema } from '@mythos/contracts/content';
import { ExtractionSchema, makeExtractionSchemas, type Entity, type Extraction, type Observation, type CommitPayload } from '@mythos/contracts';
import { consolidationGroups, extractionToCommits, selectMemories, type Candidate } from './memory';
import { eq, fixturePath } from '../test-support/harness';

const ruleset = RulesetSchema.parse(JSON.parse(readFileSync(fixturePath('library/rulesets/ruleset.standard.json'), 'utf8')));
const stats = { str: 2, end: 2, dex: 2, int: 2, cha: 2 };
const char = (id: string, kind: 'pc' | 'npc', name: string, locationId: string | null, aliases: string[] = []): Entity =>
  ({ id, kind, name, aliases, tags: [], ageCategory: 'adult', stats, statuses: [], physicalDescription: '', personality: '', goals: [], keyNpc: false, locationId, lifeState: 'alive' });
const place = (id: string, name: string): Entity => ({ id, kind: 'place', name, aliases: [], tags: [], parentPlaceId: null, description: '' });
const entities: Record<string, Entity> = Object.fromEntries([
  char('pc.wren', 'pc', 'Wren', 'place.gull-and-anchor'),
  char('npc.varek', 'npc', 'Varek Holm', 'place.gull-and-anchor', ['the clerk']),
  char('npc.odette', 'npc', 'Odette', 'place.gull-and-anchor'),
  char('npc.tomas', 'npc', 'Tomas', 'place.harbor'),
  place('place.gull-and-anchor', 'The Gull and Anchor'), place('place.harbor-office', 'Harbor Office'), place('place.harbor', 'Harbor'),
].map((e) => [e.id, e]));
let n = 0;
const ctx = {
  turnId: 'T1', gameTime: 6000, scenePlaceId: 'place.gull-and-anchor', pcId: 'pc.wren', entities,
  nearbyEntityIds: ['pc.wren', 'npc.varek', 'npc.odette', 'place.gull-and-anchor'],
  handles: { '#1': 'OBS-MERROW-LOST' }, statusIdsByName: () => [], ruleset,
  newUuid: () => `U${++n}`, newEntityId: (kind: string, name: string) => `${kind}.${name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}-a1b2`,
};
const base: Extraction = { observations: [], newEntities: [], entityUpdates: [], moves: [], itemMoves: [], quantityChanges: [], namesLearned: [], relationshipChanges: [], wikiPatches: [], statusChanges: [], clockChanges: [] };
const good: Extraction = ExtractionSchema.parse({ ...base,
  newEntities: [{ kind: 'npc', ref: 'new.bartender', name: 'the bartender', aliases: [], ageCategory: 'adult', physicalDescription: 'Tall, grey-braided.', personality: 'Watchful, says little.', stats: { str: 3 }, locationId: 'place.gull-and-anchor' }],
  observations: [
    { ref: 'o1', kind: 'speech', text: "Wren asked Varek what happened to the Merrow's Luck.", actorIds: ['pc.wren'], witnessIds: ['pc.wren', 'npc.varek', 'npc.odette', 'new.bartender'], mentionedIds: [], placeId: null, importance: 4, tags: ['merrows-luck'] },
    { ref: 'o2', kind: 'claim', text: "Varek told Wren the Merrow's Luck was lost in a squall off the point.", actorIds: ['npc.varek'], witnessIds: ['pc.wren', 'npc.varek', 'npc.odette', 'new.bartender'], mentionedIds: [], placeId: null, importance: 6, tags: ['merrows-luck'],
      claim: { sourceId: 'npc.varek', audienceIds: ['pc.wren'], content: "the Merrow's Luck was lost in a squall off the point", about: '#1', truthful: 'false' } },
    { ref: 'o3', kind: 'event', text: 'Varek feared Wren would learn about the false papers.', actorIds: ['npc.varek'], witnessIds: ['npc.varek'], mentionedIds: [], placeId: null, importance: 7, tags: ['secret'] },
    { ref: 'o4', kind: 'claim', text: 'Varek wrote Tomas a note saying a stranger is asking about the Merrow.', actorIds: ['npc.varek'], witnessIds: ['npc.varek'], mentionedIds: [], placeId: null, importance: 5, tags: [],
      claim: { sourceId: 'npc.varek', audienceIds: ['npc.tomas'], content: "a stranger is asking about the Merrow's Luck", about: 'o1', truthful: 'true' } },
  ],
  moves: [{ characterId: 'npc.varek', toPlaceId: 'place.harbor-office' }],
  relationshipChanges: [
    { fromId: 'npc.varek', toId: 'pc.wren', deltas: { fear: 1 }, reason: 'She is asking dangerous questions.', keyObservationRef: 'o1', summary: null },
    { fromId: 'npc.odette', toId: 'pc.wren', deltas: { trust: 1, affection: 1 }, reason: 'She seems honest about her brother.', keyObservationRef: null, summary: null },
  ],
  wikiPatches: [{ op: 'upsert', entityId: 'npc.varek', heading: 'Current disposition', body: 'Rattled by the stranger asking about the Merrow.', sourceRefs: ['o2', 'o3'] }],
});
const r = extractionToCommits(good, ctx);
eq('good extraction: no issues', r.issues, []);
const types = r.commits.map((c) => c.type);
eq('commit order', [...new Set(types)], ['entity.create', 'entity.move', 'observation.add', 'knowledge.grant', 'relationship.adjust', 'wiki.patch']);
const create = r.commits[0] as Extract<CommitPayload, { type: 'entity.create' }>;
eq('new NPC gets a readable ID and ruleset default stats except those shown', [create.entity.id, (create.entity as { stats: Record<string, number> }).stats], ['npc.the-bartender-a1b2', { str: 3, end: 2, dex: 2, int: 2, cha: 2 }]);
const grants = r.commits.filter((c): c is Extract<CommitPayload, { type: 'knowledge.grant' }> => c.type === 'knowledge.grant');
const knows = (who: string) => grants.filter((g) => g.grant.entityId === who).map((g) => `${g.grant.observationId}:${g.grant.via}`);
eq('the bartender witnessed the conversation', knows('npc.the-bartender-a1b2'), ['U1:witnessed', 'U2:witnessed']);
eq("only Varek knows his own fear", grants.filter((g) => g.grant.observationId === 'U3').map((g) => g.grant.entityId), ['npc.varek']);
eq('absent Tomas learns the note as a claim, told', knows('npc.tomas'), ['U4:told']);
const obs = r.commits.filter((c): c is Extract<CommitPayload, { type: 'observation.add' }> => c.type === 'observation.add');
eq('claim links to the truth it lies about, via the prompt handle', obs[1]?.observation.claim?.aboutObservationId, 'OBS-MERROW-LOST');
eq('claim about a new observation resolves its local ref', obs[3]?.observation.claim?.aboutObservationId, 'U1');
eq('nobody is granted the truth behind a claim', grants.some((g) => g.grant.observationId === 'OBS-MERROW-LOST'), false);
const rel = r.commits.find((c) => c.type === 'relationship.adjust') as Extract<CommitPayload, { type: 'relationship.adjust' }>;
eq('key observation resolved', rel.addKeyObservationIds, ['U1']);
eq('Varek leaving is not a scene change', types.includes('scene.start'), false);

// mistakes a model makes
const bad = ExtractionSchema.parse({ ...base,
  newEntities: [{ kind: 'npc', ref: 'new.odette', name: 'Odette', aliases: [], ageCategory: 'adult', physicalDescription: '', personality: 'x', stats: {}, locationId: null }],
  observations: [{ ref: 'o1', kind: 'event', text: 'Tomas saw it all.', actorIds: [], witnessIds: ['npc.tomas', 'pc.wren'], mentionedIds: [], placeId: null, importance: 3, tags: [] },
    { ref: 'o2', kind: 'event', text: 'x', actorIds: ['new.ghost'], witnessIds: ['pc.wren'], mentionedIds: [], placeId: null, importance: 3, tags: [] }],
  relationshipChanges: [{ fromId: 'pc.wren', toId: 'npc.odette', deltas: { affection: 2 }, reason: 'x', keyObservationRef: '#99', summary: null }],
});
const b = extractionToCommits(bad, ctx);
eq('every mistake is reported, with paths', b.issues.map((i) => i.path), ['newEntities[0]', 'observations[0].witnessIds', 'observations[1].actorIds[0]', 'relationshipChanges[0].fromId']);

// the PC walking out starts a scene
const walk = extractionToCommits(ExtractionSchema.parse({ ...base, moves: [{ characterId: 'pc.wren', toPlaceId: 'place.harbor' }] }), ctx);
eq('PC move adds scene.start', walk.commits.map((c) => c.type), ['entity.move', 'scene.start']);

// schema specialization
const std = makeExtractionSchemas({ statIds: ['str', 'end', 'dex', 'int', 'cha'], rating: { min: 1, max: 5 }, tagIds: ['physical', 'mental', 'social'], maxHarmLevel: 4,
  dimensionIds: ['trust', 'affection', 'respect', 'fear'], maxRelationshipChange: 3, narrativeStatuses: false, narrativeClocks: false }).extraction;
eq('specialized: relationship change capped at 3', std.safeParse({ ...good, relationshipChanges: [{ ...good.relationshipChanges[0], deltas: { fear: 4 } }] }).success, false);
eq('specialized: unknown dimension rejected', std.safeParse({ ...good, relationshipChanges: [{ ...good.relationshipChanges[0], deltas: { lust: 1 } }] }).success, false);
eq('specialized: no status changes in authoritative mode', std.safeParse({ ...good, statusChanges: [{ op: 'remove', characterId: 'pc.wren', statusName: 'x' }] }).success, false);
eq('specialized: good output passes', std.safeParse(good).success, true);

// ---------------- retrieval
const day = 1440;
const mk = (id: string, daysAgo: number, importance: number, withPc: boolean, extra: Partial<Observation> = {}): Candidate => ({
  observation: { id, turnId: 't', gameTime: 100 * day - daysAgo * day, placeId: null, kind: 'event', text: `${id} happened`, actorIds: withPc ? ['pc.wren'] : ['npc.tomas'], witnessIds: ['npc.odette'], mentionedIds: [], importance, tags: [], ...extra },
  via: 'witnessed', cosine: null, involvesPc: withPc });
const cands = [
  mk('small-talk-1', 40, 2, true), mk('small-talk-2', 39, 2, true), mk('betrayal', 60, 9, true), mk('gossip-about-tomas', 1, 3, false),
  mk('today', 0.1, 3, true), mk('yesterday', 1, 4, true), mk('relevant', 50, 3, false), mk('summary', 38, 2, true, { kind: 'summary', summarizesIds: ['small-talk-1', 'small-talk-2'] }),
];
cands[6]!.cosine = 0.9;
const w = { importance: 1, recency: 1, relevance: 1.5, entities: 0.5, pc: 0.5 };
const mem = selectMemories({ knowerId: 'npc.odette', candidates: cands, now: 100 * day, focus: new Set(['npc.varek']), weights: w, halfLifeDays: 14,
  pinnedRecent: 2, keyObservationIds: new Set(['betrayal']), tokenBudget: 25, tokens: (t) => Math.ceil(t.length / 4), names: (id) => id });
eq('pinned recent and key memories come first, then by score, within budget', mem.map((m) => `${m.observationId}:${m.reason}`).sort(),
  ['betrayal:pinned-key', 'relevant:scored', 'summary:scored', 'today:pinned-recent', 'yesterday:pinned-recent'].sort());
eq('a memory over budget is skipped and a smaller one fills the gap', mem.some((m) => m.observationId === 'gossip-about-tomas'), false);
eq('result is chronological', mem.map((m) => m.observationId), ['betrayal', 'relevant', 'summary', 'yesterday', 'today']);
eq('consolidated originals never appear', mem.some((m) => m.observationId.startsWith('small-talk')), false);
eq('claims are rendered from the knower\'s view', selectMemories({ knowerId: 'pc.wren', candidates: [{ ...mk('c', 1, 5, true), observation: { ...mk('c', 1, 5, true).observation, kind: 'claim',
  claim: { sourceId: 'Varek', audienceIds: ['you'], content: 'the pass is safe', aboutObservationId: null, truthful: 'false' } } }], now: 100 * day, focus: new Set(), weights: w, halfLifeDays: 14,
  pinnedRecent: 1, keyObservationIds: new Set(), tokenBudget: 100, tokens: (t) => t.length / 4, names: (id) => id })[0]?.text, 'Varek told you that the pass is safe');

// ---------------- consolidation never mixes knower sets
const o = (id: string, daysAgo: number, importance: number, placeId = 'place.harbor'): Observation =>
  ({ id, turnId: 't', gameTime: 100 * day - daysAgo * day, placeId, kind: 'event', text: id, actorIds: [], witnessIds: [], mentionedIds: [], importance, tags: [] });
const pool = [o('a', 61, 2), o('b', 61, 3), o('c', 60.5, 1), o('d', 60, 4), o('e', 61, 2), o('important', 61, 8), o('recent', 5, 1), o('f', 61, 2), o('g', 61, 2), o('h', 61, 2), o('i', 61, 2)];
const knowerMap: Record<string, string[]> = { e: ['pc.wren', 'npc.odette', 'npc.varek'], f: ['pc.wren', 'npc.odette', 'npc.varek'], g: ['pc.wren', 'npc.odette', 'npc.varek'], h: ['pc.wren', 'npc.odette', 'npc.varek'], i: ['npc.varek'] };
const groups = consolidationGroups(pool, (id) => knowerMap[id] ?? ['npc.odette', 'pc.wren'], 100 * day, { afterDays: 30, maxImportance: 4, minGroupSize: 4 });
eq('two groups, split by who knows them; important, recent, and small groups left alone', groups.map((g) => `${g.knowerIds.join('+')}:${g.observations.map((x) => x.id).join('')}`).sort(),
  ['npc.odette+npc.varek+pc.wren:efgh', 'npc.odette+pc.wren:abcd']);

// ---------------- PC relationships: off by default, allowed when the ruleset tracks them (MEM-064)
const pcFeel = ExtractionSchema.parse({ ...base, relationshipChanges: [{ fromId: 'pc.wren', toId: 'npc.odette', deltas: { trust: 1 }, reason: 'Wren said she trusts her.', keyObservationRef: null, summary: null }] });
eq('trackPc off: PC relationship rejected', extractionToCommits(pcFeel, ctx).issues.map((i) => i.path), ['relationshipChanges[0].fromId']);
const tracking = { ...ctx, ruleset: { ...ruleset, relationships: { ...ruleset.relationships, trackPc: 'auto' as const } } };
const tr = extractionToCommits(pcFeel, tracking);
eq('trackPc auto: PC relationship recorded', [tr.issues, tr.commits.map((c) => c.type)], [[], ['relationship.adjust']]);

// ---------------- names, quantities, ownership (JRN-021, GEAR-031, GEAR-032)
const ctxItems = { ...ctx, entities: { ...entities,
  'item.draughts': { id: 'item.draughts', kind: 'item', name: 'healing draught', aliases: [], tags: [], description: '', location: { type: 'carried', characterId: 'pc.wren' }, ownerId: 'pc.wren', quantity: 15, bonuses: [] } as Entity,
  'item.locket': { id: 'item.locket', kind: 'item', name: 'a silver locket', aliases: [], tags: [], description: '', location: { type: 'held', characterId: 'npc.odette' }, ownerId: 'npc.odette', quantity: 1, bonuses: [] } as Entity } };
const life = extractionToCommits(ExtractionSchema.parse({ ...base,
  namesLearned: [{ knowerId: 'pc.wren', entityId: 'npc.varek', name: 'Varek' }, { knowerId: 'npc.varek', entityId: 'pc.wren', name: 'Wren' }],
  quantityChanges: [{ itemId: 'item.draughts', delta: -1 }],
  itemMoves: [{ itemId: 'item.locket', to: { type: 'held', characterId: 'pc.wren' }, ownerId: 'pc.wren' }],
}), ctxItems);
eq('introductions both ways, one draught used, a locket given', [life.issues, life.commits.map((c) => c.type === 'item.quantity' ? `qty:${c.quantity}` : c.type === 'item.move' ? `move:owner=${c.ownerId}` : c.type === 'knowledge.name' ? `name:${c.knowerId}=>${c.name}` : c.type)],
  [[], ['move:owner=pc.wren', 'qty:14', 'name:pc.wren=>Varek', 'name:npc.varek=>Wren']]);
const stolen = extractionToCommits(ExtractionSchema.parse({ ...base, itemMoves: [{ itemId: 'item.locket', to: { type: 'held', characterId: 'pc.wren' } }] }), ctxItems);
eq('a theft moves the locket but leaves the owner', stolen.commits[0], { type: 'item.move', itemId: 'item.locket', to: { type: 'held', characterId: 'pc.wren' } });
eq('cannot use more draughts than exist', extractionToCommits(ExtractionSchema.parse({ ...base, quantityChanges: [{ itemId: 'item.draughts', delta: -16 }] }), ctxItems).issues.map((i) => i.message), ['only 15 left']);

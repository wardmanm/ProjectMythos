import { readFileSync } from 'node:fs';
import { CalendarDefinitionSchema, RulesetSchema } from '@mythos/contracts/content';
import { WorldTickSchema, type Clock, type CommitPayload, type Entity, type WorldTick } from '@mythos/contracts';
import { renderForKnower } from './memory';
import { worldTickToCommits, type WorldTickContext } from './world';
import { eq, fixturePath } from '../test-support/harness';
const ruleset = RulesetSchema.parse(JSON.parse(readFileSync(fixturePath('library/rulesets/ruleset.standard.json'), 'utf8')));
const calendar = CalendarDefinitionSchema.parse(JSON.parse(readFileSync(fixturePath('library/calendars/calendar.gregorian.json'), 'utf8')));
const stats = { str: 2, end: 2, dex: 2, int: 2, cha: 2 };
const ch = (id: string, kind: 'pc' | 'npc', name: string, locationId: string): Entity =>
  ({ id, kind, name, aliases: [], tags: [], ageCategory: 'adult', stats, statuses: [], physicalDescription: '', personality: '', goals: [], keyNpc: false, locationId, lifeState: 'alive' });
const place = (id: string): Entity => ({ id, kind: 'place', name: id, aliases: [], tags: [], parentPlaceId: null, description: '' });
const entities = Object.fromEntries([ch('pc.wren', 'pc', 'Wren', 'place.gull-and-anchor'), ch('npc.varek', 'npc', 'Varek', 'place.harbor-office'),
  ch('npc.tomas', 'npc', 'Tomas', 'place.harbor'), ch('npc.odette', 'npc', 'Odette', 'place.harbor'),
  place('place.gull-and-anchor'), place('place.harbor-office'), place('place.harbor')].map((e) => [e.id, e]));
const clock = (id: string, ownerId: string): Clock => ({ id, name: id, segments: 6, filled: 1, visibility: 'gm', ownerId, kind: 'progress' });
let n = 0;
const D = 1440, start = 1000 * D, end = start + 7 * D;
const ctx = (isSkip: boolean): WorldTickContext => ({
  turnId: 'T9', gameTime: end, scenePlaceId: 'place.gull-and-anchor', pcId: 'pc.wren', entities, nearbyEntityIds: [], handles: { '#3': 'OBS-OLD-CLAIM', '#4': 'OBS-OLD-EVENT' },
  statusIdsByName: () => [], ruleset, newUuid: () => `U${++n}`, newEntityId: (k, nm) => `${k}.${nm}-0000`,
  period: { start, end, coarse: true }, actorIds: ['npc.varek', 'npc.tomas', 'npc.odette'], isSkip,
  clocks: { 'clock.varek-panic': clock('clock.varek-panic', 'npc.varek'), 'clock.warden-sweep': clock('clock.warden-sweep', 'faction.tide-wardens') },
  calendar, isClaim: (id) => id === 'OBS-OLD-CLAIM',
});
const empty = { newEntities: [], entityUpdates: [], moves: [], itemMoves: [], quantityChanges: [], namesLearned: [], relationshipChanges: [], wikiPatches: [], statusChanges: [], clockChanges: [], rumors: [], goalUpdates: [], deaths: [], observations: [] };
const week: WorldTick = WorldTickSchema.parse({ ...empty, summary: 'Varek steadies the story; the harbor repeats it; Odette brings it to Wren.',
  moves: [{ characterId: 'npc.varek', toPlaceId: 'place.harbor' }, { characterId: 'npc.odette', toPlaceId: 'place.gull-and-anchor' }],
  observations: [
    { ref: 'o1', kind: 'claim', day: 2, placeId: 'place.harbor', text: 'Varek told Tomas the stranger\'s brother drowned in the squall, nothing more.', actorIds: ['npc.varek'], witnessIds: ['npc.varek', 'npc.tomas'], mentionedIds: [], importance: 6, tags: ['merrows-luck'],
      claim: { sourceId: 'npc.varek', audienceIds: ['npc.tomas'], content: "the stranger's brother drowned in the squall, nothing more", about: '#4', truthful: 'false' } },
    { ref: 'o2', kind: 'event', day: 5, placeId: 'place.gull-and-anchor', text: 'Odette visited Wren at the Gull and Anchor and brought her soup.', actorIds: ['npc.odette'], witnessIds: ['npc.odette', 'pc.wren'], mentionedIds: [], importance: 4, tags: [] },
  ],
  rumors: [{ claim: 'o1', reachedIds: ['npc.odette'] }, { claim: '#3', reachedIds: ['pc.wren'] }],
  clockChanges: [{ clockId: 'clock.varek-panic', ticks: -1 }],
  goalUpdates: [{ characterId: 'npc.varek', goals: ['Keep the stranger away from the harbor ledger'], reason: 'The story is holding; the ledger is the last risk.' }],
});
const r = worldTickToCommits(week, ctx(true));
eq('a week-long skip converts cleanly', r.issues, []);
eq('tick.record first, then moves, observations, grants, rumors, goals', [...new Set(r.commits.map((c) => c.type))],
  ['tick.record', 'entity.move', 'observation.add', 'knowledge.grant', 'clock.tick', 'entity.update-narrative']);
const obs = r.commits.filter((c): c is Extract<CommitPayload, { type: 'observation.add' }> => c.type === 'observation.add').map((c) => c.observation);
eq('events land on their day (noon), inside the period', obs.map((o) => (o.gameTime - start) / 60), [36, 108]);
const grants = r.commits.filter((c): c is Extract<CommitPayload, { type: 'knowledge.grant' }> => c.type === 'knowledge.grant').map((c) => `${c.grant.entityId}:${c.grant.observationId}:${c.grant.via}`);
eq('Tomas heard it, Odette got it as rumor, Wren saw the visit and heard the old rumor', grants,
  ['npc.varek:U1:witnessed', 'npc.tomas:U1:witnessed', 'npc.odette:U2:witnessed', 'pc.wren:U2:witnessed', 'npc.odette:U1:rumor', 'pc.wren:OBS-OLD-CLAIM:rumor']);
eq('a rumor reads as hearsay, crediting its source', renderForKnower(obs[0]!, (id) => entities[id]?.name ?? id, 'rumor'),
  "Word has it that the stranger's brother drowned in the squall, nothing more (the story started with Varek)");

// the same tick during ordinary play (not a skip): the PC is on-screen
const ordinary = worldTickToCommits(week, ctx(false));
eq('outside a skip, the PC can neither witness nor hear news off-screen', ordinary.issues.map((i) => i.path), ['observations[1].witnessIds', 'rumors[1].reachedIds[0]']);

const bad = WorldTickSchema.parse({ ...empty, summary: 'x',
  observations: [{ ref: 'o1', kind: 'event', day: 1, placeId: 'place.harbor', text: 'Wren argued with Tomas.', actorIds: ['pc.wren'], witnessIds: ['npc.tomas', 'npc.varek'], mentionedIds: [], importance: 3, tags: [] }],
  moves: [{ characterId: 'pc.wren', toPlaceId: 'place.harbor' }],
  rumors: [{ claim: 'o1', reachedIds: ['npc.odette'] }],
  clockChanges: [{ clockId: 'clock.warden-sweep', ticks: 1 }],
  relationshipChanges: [{ fromId: 'pc.wren', toId: 'npc.tomas', deltas: { trust: -1 }, reason: 'x', keyObservationRef: null, summary: null }],
  goalUpdates: [{ characterId: 'pc.wren', goals: ['Leave town'], reason: 'x' }],
  deaths: [{ characterId: 'pc.wren', cause: 'x' }],
});
const b = worldTickToCommits(bad, ctx(true));
eq('every off-screen rule violation is reported', b.issues.map((i) => i.message), [
  'only the player moves the PC',
  'npc.varek was not at place.harbor; they can only learn of this by being told',
  'the PC acts only through the player',
  "the PC's feelings never change off-screen",
  'clock.warden-sweep belongs to faction.tide-wardens, who is not acting in this period',
  'o1 is not a claim; only claims spread as rumor',
  "the PC's goals are the player's",
  'the PC never dies off-screen',
]);
const heroicNpcs = { ...ctx(true), ruleset: { ...ruleset, lethality: { pc: 'heroic' as const, npc: 'heroic' as const } } };
eq('NPC deaths respect lethality', worldTickToCommits(WorldTickSchema.parse({ ...empty, summary: 'x', deaths: [{ characterId: 'npc.tomas', cause: 'lost at sea' }] }), heroicNpcs).issues.map((i) => i.message),
  ['NPCs cannot die in this campaign (lethality)']);
eq('...and are recorded when lethal', worldTickToCommits(WorldTickSchema.parse({ ...empty, summary: 'x', deaths: [{ characterId: 'npc.tomas', cause: 'lost at sea' }] }), ctx(true)).commits.map((c) => c.type), ['tick.record', 'entity.death']);

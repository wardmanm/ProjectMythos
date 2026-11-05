import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommitPayload, Observation } from '@mythos/contracts';
import { CalendarDefinitionSchema, type HistoryEntry } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { historyPayloads, withoutOtherPcs } from './setup-history';
import { character, historyEntry, item, ROOT_TURN, testId } from './test-support';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const calendar = CalendarDefinitionSchema.parse(
  JSON.parse(
    readFileSync(path.join(repoRoot, 'content-library/calendars/calendar.gregorian.json'), 'utf8'),
  ),
);
const at = {
  calendar,
  epoch: { year: 1874, month: 10, day: 12, hour: 0, minute: 0 },
  turnId: ROOT_TURN,
};

const claim = (sourceId: string, audienceIds: string[], aboutRef: string | null = null) => ({
  sourceId,
  audienceIds,
  content: `${sourceId} said so.`,
  aboutRef,
  truthful: 'unknown' as const,
});

/** History in which Ash, a premade PC who is not chosen, witnessed, claimed, and was told. */
const history: HistoryEntry[] = [
  historyEntry('storm', {
    when: { year: 1874, month: 10, day: 12, hour: 2, minute: 0 },
    placeId: 'place.dock',
    actorIds: ['npc.tomas'],
    witnessIds: ['npc.tomas', 'pc.ash'],
    alsoKnownBy: [
      { entityId: 'npc.odette', via: 'rumor' },
      { entityId: 'pc.wren', via: 'inferred' },
      { entityId: 'npc.tomas', via: 'rumor' },
    ],
  }),
  historyEntry('letter', {
    kind: 'claim',
    actorIds: ['npc.tomas'],
    witnessIds: ['npc.tomas'],
    claim: claim('npc.tomas', ['pc.wren', 'npc.tomas'], 'storm'),
  }),
  historyEntry('ash-boast', {
    kind: 'claim',
    witnessIds: ['pc.ash', 'npc.odette'],
    claim: claim('pc.ash', ['npc.odette']),
  }),
  historyEntry('note-to-ash', {
    kind: 'claim',
    witnessIds: ['npc.odette'],
    claim: claim('npc.odette', ['pc.ash']),
  }),
  historyEntry('gossip', {
    kind: 'claim',
    actorIds: ['npc.odette', 'pc.ash'],
    witnessIds: ['npc.odette', 'pc.ash'],
    claim: claim('npc.odette', ['npc.tomas', 'pc.ash'], 'ash-boast'),
  }),
  historyEntry('secret', {
    witnessIds: ['npc.odette'],
    alsoKnownBy: [{ entityId: 'pc.ash', via: 'told' }],
  }),
];

/** Wren is chosen. Ash holds a bag with a coin in it and owns a locket left at the inn. */
const unpruned = {
  entities: [
    character('npc.odette'),
    character('npc.tomas'),
    character('pc.ash'),
    character('pc.wren'),
    item(
      'item.ash-bag',
      { type: 'held', characterId: 'pc.ash' },
      {
        container: { capacity: 4, maxItemSize: 'small' },
      },
    ),
    item('item.ash-coin', { type: 'contained', containerId: 'item.ash-bag' }, { size: 'tiny' }),
    item('item.locket', { type: 'placed', placeId: 'place.inn' }, { ownerId: 'pc.ash' }),
  ],
  history,
  relationships: [
    { fromId: 'npc.odette', toId: 'pc.ash', dimensions: { trust: 2 }, summary: 'Her lodger.' },
    { fromId: 'npc.odette', toId: 'pc.wren', dimensions: { trust: 1 }, summary: 'A stranger.' },
  ],
  presentEntityIds: ['npc.odette', 'pc.ash'],
};

const pruned = () => withoutOtherPcs(unpruned, 'pc.wren');

/** Pruned history as payloads, with observation IDs from 101 upwards. */
function payloads(): CommitPayload[] {
  let next = 100;
  return historyPayloads(pruned().history, at, () => testId((next += 1)));
}

const observations = (from: readonly CommitPayload[]): Observation[] =>
  from.flatMap((payload) => (payload.type === 'observation.add' ? [payload.observation] : []));

function grantsOf(from: readonly CommitPayload[], observationId: string) {
  return from.flatMap((payload) =>
    payload.type === 'knowledge.grant' && payload.grant.observationId === observationId
      ? [{ entityId: payload.grant.entityId, via: payload.grant.via }]
      : [],
  );
}

describe('withoutOtherPcs', () => {
  it('SCH-113, SCH-116: a premade PC that is not chosen is removed from everything, each removal a warning', () => {
    const { entities, relationships, presentEntityIds, warnings } = pruned();
    expect(entities.map(({ id }) => id)).toEqual([
      'npc.odette',
      'npc.tomas',
      'pc.wren',
      'item.locket',
    ]);
    expect(entities[3]).toMatchObject({ ownerId: null });
    expect(relationships.map(({ toId }) => toId)).toEqual(['pc.wren']);
    expect(presentEntityIds).toEqual(['npc.odette']);
    expect(warnings).toEqual([
      'pc.ash is left out: a campaign has only the chosen PC',
      'item.ash-bag is left out: pc.ash has it',
      'item.ash-coin is left out: pc.ash has it',
      'item.locket belongs to nobody: its owner, pc.ash, is left out',
      'pc.ash is removed from the witnesses of history entry "storm"',
      'history entry "ash-boast" is left out: its claim\'s source, pc.ash, is left out',
      'pc.ash is removed from the claim audience of history entry "note-to-ash"',
      'history entry "note-to-ash" is left out: its claim has no one left to tell',
      'pc.ash is removed from the actors of history entry "gossip"',
      'pc.ash is removed from the witnesses of history entry "gossip"',
      'pc.ash is removed from the claim audience of history entry "gossip"',
      'history entry "gossip"\'s claim is about "ash-boast", which is left out, so it is about nothing',
      'pc.ash is removed from the other knowers of history entry "secret"',
      'the relationship from npc.odette to pc.ash is left out: pc.ash is left out',
      'pc.ash is not present at the start: it is left out',
    ]);
  });

  it('SCH-116: a claim left with no audience is dropped, and a claim about a dropped entry is about nothing', () => {
    const kept = pruned().history;
    expect(kept.map(({ ref }) => ref)).toEqual(['storm', 'letter', 'gossip', 'secret']);
    expect(kept[2]?.claim).toMatchObject({ audienceIds: ['npc.tomas'], aboutRef: null });
  });

  it('SCH-113: a pack with only the chosen PC is unchanged, with no warnings', () => {
    const alone = {
      entities: [character('pc.wren')],
      history: [],
      relationships: [],
      presentEntityIds: [],
    };
    expect(withoutOtherPcs(alone, 'pc.wren')).toEqual({ ...alone, warnings: [] });
  });
});

describe('historyPayloads', () => {
  it('SCH-117: each entry is an observation in file order, dated from the calendar, with no mentions, its claim linked to the earlier entry', () => {
    const [storm, letter, , secret] = observations(payloads());
    expect(storm).toEqual<Observation>({
      id: testId(101),
      turnId: ROOT_TURN,
      gameTime: 2 * 60,
      placeId: 'place.dock',
      kind: 'event',
      text: 'storm happened.',
      actorIds: ['npc.tomas'],
      witnessIds: ['npc.tomas'],
      mentionedIds: [],
      importance: 5,
      tags: [],
    });
    expect(letter?.claim?.aboutObservationId).toBe(testId(101));
    expect(secret?.gameTime).toBe(0);
  });

  it("MEM-010, CON-071: every witness has a witnessed grant at the observation's game time, right after it", () => {
    const all = payloads();
    expect(all.slice(0, 2)).toEqual([
      { type: 'observation.add', observation: observations(all)[0] },
      {
        type: 'knowledge.grant',
        grant: {
          entityId: 'npc.tomas',
          observationId: testId(101),
          via: 'witnessed',
          viaObservationId: null,
          gameTime: 2 * 60,
        },
      },
    ]);
    for (const observation of observations(all)) {
      for (const entityId of observation.witnessIds) {
        expect(grantsOf(all, observation.id)).toContainEqual({ entityId, via: 'witnessed' });
      }
    }
  });

  it('MEM-034: a claim audience member who did not witness it is told, and a witness is not told again', () => {
    expect(grantsOf(payloads(), testId(102))).toEqual([
      { entityId: 'npc.tomas', via: 'witnessed' },
      { entityId: 'pc.wren', via: 'told' },
    ]);
  });

  it('MEM-035: alsoKnownBy grants keep their own via, inferred included, one grant per knower', () => {
    expect(grantsOf(payloads(), testId(101))).toEqual([
      { entityId: 'npc.tomas', via: 'witnessed' },
      { entityId: 'npc.odette', via: 'rumor' },
      { entityId: 'pc.wren', via: 'inferred' },
    ]);
  });
});

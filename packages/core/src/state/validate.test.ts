import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommitPayload, CommitSet, SemanticIssue } from '@mythos/contracts';
import { RulesetSchema, SlotSchemaDefinitionSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { applyCommit } from './apply-commit';
import { validateSet } from './fold';
import type { FoldContext, FoldedState } from './folded-state';
import {
  character,
  commitSet,
  HELLO,
  item,
  observation,
  place,
  setupEntry,
  startState,
  testId,
} from './test-support';
import { commitIssues } from './validate';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
const context: FoldContext = {
  ruleset: RulesetSchema.parse(readJson('content-library/rulesets/ruleset.standard.json')),
  slots: SlotSchemaDefinitionSchema.parse(
    readJson('content-packs/reference/slot-schemas/slots.everyday.json'),
  ),
};

function setUp(): FoldedState {
  const setup = validateSet(startState(), setupEntry(), context);
  if (!setup.ok) throw new Error(JSON.stringify(setup.error));
  return applyCommit(setup.value, {
    type: 'entity.create',
    entity: {
      id: 'faction.wardens',
      kind: 'faction',
      name: 'Wardens',
      aliases: [],
      tags: [],
      description: '',
      goals: [],
    },
  });
}
const base = setUp();
const extraction = commitSet(20, 'extraction', { origin: 'model' });
const edit = commitSet(21, 'player-edit', { origin: 'player' });

const issuesOf = (payload: CommitPayload, set: CommitSet = extraction): SemanticIssue[] =>
  commitIssues(base, payload, set, context);
const pathsOf = (payload: CommitPayload, set: CommitSet = extraction): string[] =>
  issuesOf(payload, set).map((found) => found.path);

describe('commitIssues', () => {
  it('CON-070: a claim needs "claim", an event has none, and a summary summarizes something', () => {
    const claimWithout = observation(60, { kind: 'claim' });
    const eventWith = observation(61, {
      claim: {
        sourceId: 'npc.odette',
        audienceIds: ['pc.wren'],
        content: 'The tide turns at nine.',
        aboutObservationId: null,
        truthful: 'unknown',
      },
    });
    const emptySummary = observation(62, { kind: 'summary', summarizesIds: [] });
    expect(issuesOf({ type: 'observation.add', observation: claimWithout })).toEqual([
      { path: 'observation.claim', message: 'a claim needs "claim"' },
    ]);
    expect(issuesOf({ type: 'observation.add', observation: eventWith })).toEqual([
      { path: 'observation.claim', message: 'event observations have no "claim"' },
    ]);
    expect(issuesOf({ type: 'observation.add', observation: emptySummary })).toEqual([
      { path: 'observation.summarizesIds', message: 'a summary needs what it summarizes' },
    ]);
    const summary = observation(63, { kind: 'summary', summarizesIds: [HELLO] });
    expect(issuesOf({ type: 'observation.add', observation: summary })).toEqual([]);
  });

  it("CON-005: an observation's references must exist, have the right kind, and be known", () => {
    const told = observation(64, {
      kind: 'claim',
      placeId: 'npc.odette',
      actorIds: ['faction.wardens', 'place.inn'],
      witnessIds: ['faction.wardens'],
      mentionedIds: ['item.satchel', 'npc.nobody'],
      claim: {
        sourceId: 'place.town',
        audienceIds: ['pc.wren'],
        content: 'The wardens are watching.',
        aboutObservationId: testId(99),
        truthful: 'partly',
      },
    });
    expect(pathsOf({ type: 'observation.add', observation: told })).toEqual([
      'observation.placeId',
      'observation.actorIds.1',
      'observation.witnessIds.0',
      'observation.mentionedIds.1',
      'observation.claim.sourceId',
      'observation.claim.aboutObservationId',
    ]);
    const again = observation(50);
    expect(issuesOf({ type: 'observation.add', observation: again })).toEqual([
      { path: 'observation.id', message: `observation "${HELLO}" already exists` },
    ]);
  });

  it('CON-073: a relationship joins two different characters on ruleset dimensions, in range', () => {
    const self: CommitPayload = {
      type: 'relationship.set',
      fromId: 'pc.wren',
      toId: 'pc.wren',
      dimensions: { loyalty: 1, trust: 9 },
      summary: null,
    };
    expect(issuesOf(self, edit)).toEqual([
      { path: 'toId', message: 'a relationship is between two different characters' },
      {
        path: 'dimensions.loyalty',
        message: '"loyalty" is not a relationship dimension in ruleset.standard',
      },
      { path: 'dimensions.trust', message: '9 is outside -5 to 5' },
    ]);
    const toPlace: CommitPayload = {
      type: 'relationship.set',
      fromId: 'npc.odette',
      toId: 'place.inn',
      dimensions: { trust: 1 },
      summary: null,
    };
    expect(issuesOf(toPlace, edit)).toEqual([
      { path: 'toId', message: '"place.inn" is a place, not a character' },
    ]);
    // Factions wait for a ruleset switch (03-contracts Open).
    expect(pathsOf({ ...toPlace, toId: 'faction.wardens' }, edit)).toEqual(['toId']);
  });

  it('CSET-044: entity.create on an existing ID is rejected, so ageCategory never changes', () => {
    const younger = character('pc.wren', { ageCategory: 'minor', locationId: 'place.inn' });
    expect(issuesOf({ type: 'entity.create', entity: younger })).toEqual([
      { path: 'entity.id', message: '"pc.wren" already exists' },
    ]);
  });

  it('CON-041: what an entity references must exist and be of the right kind', () => {
    const lost = character('npc.ferryman', { locationId: 'npc.odette' });
    expect(issuesOf({ type: 'entity.create', entity: lost })).toEqual([
      { path: 'entity.locationId', message: '"npc.odette" is a character, not a place' },
    ]);
    const orphan = place('place.cellar', 'place.nowhere');
    expect(issuesOf({ type: 'entity.create', entity: orphan })).toEqual([
      { path: 'entity.parentPlaceId', message: '"place.nowhere" does not exist' },
    ]);
    const shelf = item(
      'item.key',
      { type: 'held', characterId: 'place.inn' },
      { ownerId: 'place.town' },
    );
    expect(pathsOf({ type: 'entity.create', entity: shelf })).toEqual([
      'entity.location.characterId',
      'entity.ownerId',
    ]);
    const owned = item(
      'item.badge',
      { type: 'placed', placeId: 'place.inn' },
      { ownerId: 'faction.wardens' },
    );
    expect(issuesOf({ type: 'entity.create', entity: owned })).toEqual([]);
  });

  it('CON-041: moves, scenes, grants, and names name entities of the right kind', () => {
    expect(
      pathsOf({ type: 'entity.move', characterId: 'item.satchel', toPlaceId: 'pc.wren' }),
    ).toEqual(['characterId', 'toPlaceId']);
    expect(issuesOf({ type: 'entity.move', characterId: 'npc.odette', toPlaceId: null })).toEqual(
      [],
    );
    expect(pathsOf({ type: 'scene.start', sceneId: testId(70), placeId: 'npc.odette' })).toEqual([
      'placeId',
    ]);
    const grant: CommitPayload = {
      type: 'knowledge.grant',
      grant: {
        entityId: 'faction.wardens',
        observationId: testId(98),
        via: 'told',
        viaObservationId: testId(97),
        gameTime: 0,
      },
    };
    expect(pathsOf(grant)).toEqual([
      'grant.entityId',
      'grant.observationId',
      'grant.viaObservationId',
    ]);
    expect(
      pathsOf({ type: 'knowledge.name', knowerId: 'place.inn', entityId: 'npc.gone', name: 'X' }),
    ).toEqual(['knowerId', 'entityId']);
  });

  it('CON-042: item.move checks the item, what its location names, and the gear rules', () => {
    expect(issuesOf({ type: 'item.move', itemId: 'item.nothing', to: { type: 'gone' } })).toEqual([
      { path: 'itemId', message: '"item.nothing" does not exist' },
    ]);
    expect(
      pathsOf({
        type: 'item.move',
        itemId: 'item.satchel',
        to: { type: 'held', characterId: 'npc.ghost' },
        ownerId: 'place.inn',
      }),
    ).toEqual(['to.characterId', 'ownerId']);
    // The satchel takes small items only, and nothing can go inside itself.
    expect(
      issuesOf({
        type: 'item.move',
        itemId: 'item.satchel',
        to: { type: 'contained', containerId: 'item.satchel' },
      }),
    ).toEqual([
      { path: 'to', message: 'satchel cannot go inside itself' },
      { path: 'to', message: 'satchel is too big for satchel' },
    ]);
    expect(
      issuesOf({
        type: 'item.move',
        itemId: 'item.satchel',
        to: { type: 'contained', containerId: 'item.box' },
      }),
    ).toEqual([{ path: 'to', message: 'there is no "item.box" to put it in' }]);
  });

  it('CON-005: the stage is checked along with everything else', () => {
    const move: CommitPayload = { type: 'scene.start', sceneId: testId(71), placeId: 'place.gone' };
    expect(issuesOf(move, commitSet(22, 'narration'))).toEqual([
      { path: 'type', message: 'scene.start is not allowed in narration sets' },
      { path: 'placeId', message: '"place.gone" does not exist' },
    ]);
  });
});

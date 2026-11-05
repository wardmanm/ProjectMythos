import { type CommitPayload, CommitPayloadSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { applyCommit } from './apply-commit';
import type { FoldedState } from './folded-state';
import { character, item, observation, place, startState, testId } from './test-support';

const applyAll = (state: FoldedState, payloads: readonly CommitPayload[]): FoldedState =>
  payloads.reduce(applyCommit, state);

const world = applyAll(startState(), [
  { type: 'entity.create', entity: place('place.inn') },
  { type: 'entity.create', entity: character('pc.wren', { locationId: 'place.inn' }) },
  { type: 'entity.create', entity: character('npc.odette', { locationId: 'place.inn' }) },
  {
    type: 'entity.create',
    entity: item('item.locket', { type: 'held', characterId: 'pc.wren' }, { ownerId: 'pc.wren' }),
  },
]);

describe('applyCommit', () => {
  it('TRN-065: entity.create adds the entity under its ID', () => {
    expect(Object.keys(world.world.entities)).toEqual([
      'place.inn',
      'pc.wren',
      'npc.odette',
      'item.locket',
    ]);
  });

  it('TRN-065: time.advance adds its minutes to game time', () => {
    const later = applyAll(world, [
      { type: 'time.advance', minutes: 90, reason: 'a long talk' },
      { type: 'time.advance', minutes: 30, reason: 'a walk' },
    ]);
    expect(later.world.gameTime).toBe(120);
  });

  it('TRN-065: scene.start sets the scene and its place', () => {
    const next = applyCommit(world, {
      type: 'scene.start',
      sceneId: testId(7),
      placeId: 'place.inn',
    });
    expect(next.world.sceneId).toBe(testId(7));
    expect(next.world.scenePlaceId).toBe('place.inn');
  });

  it('TRN-065: entity.move changes a character location, and null takes them off the map', () => {
    const gone = applyCommit(world, {
      type: 'entity.move',
      characterId: 'npc.odette',
      toPlaceId: null,
    });
    expect(gone.world.entities['npc.odette']).toMatchObject({ locationId: null });
  });

  it('TRN-065: flag.set sets a flag, and a null value removes it', () => {
    const set = applyCommit(world, { type: 'flag.set', key: 'bell-rung', value: 3 });
    expect(set.world.flags).toEqual({ 'bell-rung': 3 });
    const removed = applyCommit(set, { type: 'flag.set', key: 'bell-rung', value: null });
    expect(removed.world.flags).toEqual({});
  });

  it('TRN-065: item.move changes the owner only when ownerId is present', () => {
    const placed = { type: 'placed', placeId: 'place.inn' } as const;
    const kept = applyCommit(world, { type: 'item.move', itemId: 'item.locket', to: placed });
    expect(kept.world.entities['item.locket']).toMatchObject({
      location: placed,
      ownerId: 'pc.wren',
    });
    const given = applyCommit(kept, {
      type: 'item.move',
      itemId: 'item.locket',
      to: { type: 'held', characterId: 'npc.odette' },
      ownerId: 'npc.odette',
    });
    expect(given.world.entities['item.locket']).toMatchObject({ ownerId: 'npc.odette' });
    const lost = applyCommit(given, {
      type: 'item.move',
      itemId: 'item.locket',
      to: placed,
      ownerId: null,
    });
    expect(lost.world.entities['item.locket']).toMatchObject({ ownerId: null });
  });

  it('TRN-064: relationship.set merges dimensions, and a null summary leaves the summary as it was', () => {
    const first = applyCommit(world, {
      type: 'relationship.set',
      fromId: 'npc.odette',
      toId: 'pc.wren',
      dimensions: { trust: 1 },
      summary: null,
    });
    expect(first.relationships['npc.odette>pc.wren']).toEqual({
      fromId: 'npc.odette',
      toId: 'pc.wren',
      dimensions: { trust: 1 },
      summary: '',
      keyObservationIds: [],
    });
    const second = applyAll(first, [
      {
        type: 'relationship.set',
        fromId: 'npc.odette',
        toId: 'pc.wren',
        dimensions: { fear: -1 },
        summary: 'Wary of the stranger.',
      },
      {
        type: 'relationship.set',
        fromId: 'npc.odette',
        toId: 'pc.wren',
        dimensions: { trust: 2 },
        summary: null,
      },
    ]);
    expect(second.relationships['npc.odette>pc.wren']).toMatchObject({
      dimensions: { trust: 2, fear: -1 },
      summary: 'Wary of the stranger.',
    });
  });

  it('TRN-064: knowledge.name keeps the latest name each knower learned', () => {
    const named = applyAll(world, [
      {
        type: 'knowledge.name',
        knowerId: 'pc.wren',
        entityId: 'npc.odette',
        name: 'the innkeeper',
      },
      { type: 'knowledge.name', knowerId: 'pc.wren', entityId: 'npc.odette', name: 'Odette' },
      { type: 'knowledge.name', knowerId: 'npc.odette', entityId: 'pc.wren', name: 'Wren' },
    ]);
    expect(named.names).toEqual({
      'pc.wren': { 'npc.odette': 'Odette' },
      'npc.odette': { 'pc.wren': 'Wren' },
    });
  });

  it('TRN-064: observation.add records the observation ID and nothing else', () => {
    const seen = applyCommit(world, { type: 'observation.add', observation: observation(40) });
    expect(seen.knownObservationIds).toEqual([testId(40)]);
    expect(seen.world).toBe(world.world);
  });

  it('TRN-065: input.set, narration.set, and knowledge.grant return the state unchanged', () => {
    const unchanged: CommitPayload[] = [
      { type: 'input.set', mode: 'ic', text: 'I ask for a room.' },
      { type: 'narration.set', text: 'Odette slides a key across.', complete: true },
      {
        type: 'knowledge.grant',
        grant: {
          entityId: 'pc.wren',
          observationId: testId(40),
          via: 'inferred',
          viaObservationId: null,
          gameTime: 0,
        },
      },
    ];
    for (const payload of unchanged) expect(applyCommit(world, payload)).toBe(world);
  });

  it('CON-085: a type whose reducer is not built yet throws, naming its phase', () => {
    const unbuilt: [CommitPayload, string][] = [
      [{ type: 'override.record', target: 'narration', instruction: null }, 'phase 2'],
      [{ type: 'clock.tick', clockId: 'clock.alarm', ticks: 1 }, 'phase 3'],
      [
        { type: 'wiki.patch', entityId: 'pc.wren', op: { op: 'remove-section', heading: 'Past' } },
        'phase 4',
      ],
      [{ type: 'note.delete', noteId: testId(3) }, 'phase 5'],
      [
        {
          type: 'tick.record',
          periodStart: 0,
          periodEnd: 60,
          coarse: false,
          actorIds: [],
          summary: '',
        },
        'phase 7',
      ],
    ];
    for (const [payload, phase] of unbuilt) {
      expect(() => applyCommit(world, payload)).toThrow(`${payload.type} arrives in ${phase}`);
    }
  });
});

describe('ageCategory', () => {
  it('CSET-063: no commit type except entity.create carries an ageCategory', () => {
    const carrying = CommitPayloadSchema.options
      .filter((option) => JSON.stringify(option.toJSONSchema()).includes('"ageCategory"'))
      .map((option) => option.shape.type.value);
    expect(carrying).toEqual(['entity.create']);
  });
});

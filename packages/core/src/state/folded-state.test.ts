import { WorldStateSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { initialState, relationshipKey } from './folded-state';
import { testId } from './test-support';

describe('initialState', () => {
  it('SCH-118: folding starts at game time 0 with no entities, clocks, or flags', () => {
    const state = initialState({
      pcId: 'pc.wren',
      scenePlaceId: 'place.gull-and-anchor',
      sceneId: testId(2),
    });
    expect(state).toEqual({
      world: {
        gameTime: 0,
        sceneId: testId(2),
        scenePlaceId: 'place.gull-and-anchor',
        pcId: 'pc.wren',
        entities: {},
        clocks: {},
        flags: {},
      },
      relationships: {},
      names: {},
      knownObservationIds: [],
    });
    expect(WorldStateSchema.parse(state.world)).toEqual(state.world);
  });
});

describe('relationshipKey', () => {
  it('TRN-064: relationships are keyed by direction', () => {
    expect(relationshipKey('npc.odette', 'pc.wren')).toBe('npc.odette>pc.wren');
    expect(relationshipKey('pc.wren', 'npc.odette')).not.toBe(
      relationshipKey('npc.odette', 'pc.wren'),
    );
  });
});

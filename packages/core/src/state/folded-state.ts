// The folded state (06-turn-engine §6.2): what folding commit sets produces. Its shape is
// internal to core and versioned with the snapshot format (TRN-064). It is plain data,
// records and arrays only, so a snapshot can store it as JSON.
import type { Relationship, WorldState } from '@mythos/contracts';
import type { Ruleset, SlotSchemaDefinition } from '@mythos/contracts/content';

/**
 * Implements TRN-064. Wiki sections arrive with `wiki.patch` in phase 4, and notes and
 * beliefs with their reducers in phase 5 (06-turn-engine Open).
 */
export type FoldedState = {
  world: WorldState;
  /** Keyed by `relationshipKey(fromId, toId)`. */
  relationships: Record<string, Relationship>;
  /** `names[knowerId][entityId]`: the latest name the knower learned (JRN-020). */
  names: Record<string, Record<string, string>>;
  /** Every observation added so far, in commit order. Used only for validation. */
  knownObservationIds: string[];
};

/** What validation needs from the campaign's content snapshot. */
export type FoldContext = {
  ruleset: Ruleset;
  slots: SlotSchemaDefinition;
};

/** The key of a directed relationship in `FoldedState.relationships`. */
export function relationshipKey(fromId: string, toId: string): string {
  return `${fromId}>${toId}`;
}

/**
 * The state folding starts from, built from the campaign record: game time 0, no
 * entities, clocks, or flags, the PC's ID, the start place, and the first scene's ID.
 * Implements SCH-118.
 */
export function initialState(start: {
  pcId: string;
  scenePlaceId: string;
  sceneId: string;
}): FoldedState {
  return {
    world: {
      gameTime: 0,
      sceneId: start.sceneId,
      scenePlaceId: start.scenePlaceId,
      pcId: start.pcId,
      entities: {},
      clocks: {},
      flags: {},
    },
    relationships: {},
    names: {},
    knownObservationIds: [],
  };
}

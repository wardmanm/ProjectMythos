// What a prompt reads (TRN-060): a campaign's content snapshot and settings, and its
// state folded at a read point, with the current scene's earlier turns.
import type { ReadPoint } from '@mythos/contracts';
import type {
  CalendarDefinition,
  ContentSettings,
  Ruleset,
  Scenario,
  Setting,
  SlotSchemaDefinition,
  ToneProfile,
} from '@mythos/contracts/content';
import {
  type CommitSetEntry,
  entriesInOrder,
  type FoldContext,
  type FoldedState,
  fold,
  initialState,
} from '@mythos/core';
import {
  type CampaignStore,
  type Database,
  readCanon,
  readSetsForRead,
  readState,
  readTurn,
} from '../storage';

/** One earlier turn of the current scene, as the transcript shows it (CTX-040). */
export type SceneTurn = { input: string | null; narration: string };

/** What a prompt for the point's turn reads, all from the campaign's own database. */
export type CampaignAtPoint = {
  pcId: string;
  setting: Setting;
  calendar: CalendarDefinition;
  slots: SlotSchemaDefinition;
  tone: ToneProfile;
  ruleset: Ruleset;
  scenario: Scenario;
  /** The scenario's opening file (SCH-073). */
  opening: string;
  /** The campaign's current settings, before automatic tightening (CSET-020). */
  contentSettings: ContentSettings;
  /** The folded state at the point. */
  state: FoldedState;
  /** The current scene's turns before the point's turn, oldest first, each narrated. */
  sceneTurns: SceneTurn[];
  /** The point's turn: the root turn, which opens the story (CTX-076), or its input. */
  turn: { opening: true } | { opening: false; input: string };
};

// A campaign database missing what creation always writes is corrupt (CONV-041).
function stored<T>(db: Database, value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${db.path} has no ${what}`);
  return value;
}

/**
 * Each turn's input and narration since the last `scene.start`, in order. A scene starts
 * on the turn whose sets start it, so that turn's narration belongs to the new scene.
 */
function turnsOfScene(entries: readonly CommitSetEntry[]) {
  let turns = new Map<string, { input: string | null; narration: string | null }>();
  for (const { set, commits } of entries) {
    for (const { payload } of commits) {
      if (payload.type === 'scene.start') {
        const own = turns.get(set.turnId);
        turns = new Map(own === undefined ? [] : [[set.turnId, own]]);
      }
      const turn = turns.get(set.turnId) ?? { input: null, narration: null };
      if (payload.type === 'input.set') turn.input = payload.text;
      if (payload.type === 'narration.set') turn.narration = payload.text;
      turns.set(set.turnId, turn);
    }
  }
  return turns;
}

/**
 * Reads the campaign at `point` (TRN-060): its snapshot and settings, the state folded
 * from the point's active sets, the current scene's earlier narrated turns, and the
 * point's turn. A root turn opens the story; any other turn must have its input.
 */
export function readAtPoint(store: CampaignStore, db: Database, point: ReadPoint): CampaignAtPoint {
  const record = store.readCampaign(db);
  const canon = <K extends 'calendar' | 'slots' | 'tone' | 'ruleset' | 'scenario'>(
    kind: K,
    id: string,
  ) => stored(db, readCanon(db, kind, id), `${kind} ${id}`);
  const setting = stored(db, readCanon(db, 'setting', record.settingId), record.settingId).value;
  const tone = canon('tone', record.toneProfileId).value;
  const scenario = canon('scenario', record.scenarioId);
  const context: FoldContext = {
    ruleset: canon('ruleset', record.rulesetId).value,
    slots: canon('slots', tone.slotSchemaId ?? setting.slotSchemaId).value,
  };

  // The point's active sets in TRN-061's order, which core defines once.
  const entries = entriesInOrder(readSetsForRead(db, point));
  const start = initialState({
    pcId: record.pcId,
    scenePlaceId: scenario.value.startPlaceId,
    sceneId: record.firstSceneId,
  });
  const { state } = fold(start, entries, context);

  const turns = turnsOfScene(entries);
  const sceneTurns: SceneTurn[] = [];
  for (const [turnId, turn] of turns) {
    if (turnId === point.turnId || turn.narration === null) continue;
    sceneTurns.push({ input: turn.input, narration: turn.narration });
  }
  const own = stored(db, readTurn(db, point.turnId), `turn ${point.turnId}`);
  const input = turns.get(point.turnId)?.input ?? null;
  let turn: CampaignAtPoint['turn'] = { opening: true };
  if (own.parentTurnId !== null) {
    // The caller reads a turn's prompt only once its input is stored (TRN-011).
    if (input === null) throw new Error(`turn ${point.turnId} has no input at its read point`);
    turn = { opening: false, input };
  }

  return {
    pcId: record.pcId,
    setting,
    calendar: canon('calendar', setting.calendarId).value,
    slots: context.slots,
    tone,
    ruleset: context.ruleset,
    scenario: scenario.value,
    opening: stored(db, scenario.markdown, `opening for ${scenario.id}`),
    contentSettings: stored(db, readState(db, 'content_settings'), 'content settings'),
    state,
    sceneTurns,
    turn,
  };
}

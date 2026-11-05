import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CampaignView, CommitPayload, Observation } from '@mythos/contracts';
import { CampaignViewSchema } from '@mythos/contracts';
import { fold, initialState, toDate } from '@mythos/core';
import { afterEach, describe, expect, it } from 'vitest';
import { type CampaignRecord, readCanon, readSetsForRead, readTurn } from '../storage';
import { createCampaign } from './create-campaign';
import { arrivalCommand, createTestSpace, setupPayloads, TEST_NOW } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

/** A campaign from *Arrival*, its database, and its setup set's payloads. */
async function arrival() {
  const deps = space.deps();
  const result = await createCampaign(deps, arrivalCommand());
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const view: CampaignView = result.value;
  const opened = deps.store.openCampaign(view.campaignId);
  if (!opened.ok) throw new Error('the new campaign would not open');
  const db = opened.value;
  return { deps, view, db, payloads: setupPayloads(db, view.currentBranchId, view.headTurnId) };
}

/** History's observations by the start of their text, for readable assertions. */
function observationStarting(payloads: readonly CommitPayload[], start: string): Observation {
  const found = payloads.find(
    (payload) => payload.type === 'observation.add' && payload.observation.text.startsWith(start),
  );
  if (found?.type !== 'observation.add') throw new Error(`no observation "${start}…"`);
  return found.observation;
}

function knowersOf(payloads: readonly CommitPayload[], observation: Observation) {
  return payloads.flatMap((payload) =>
    payload.type === 'knowledge.grant' && payload.grant.observationId === observation.id
      ? [{ entityId: payload.grant.entityId, via: payload.grant.via }]
      : [],
  );
}

describe('createCampaign', () => {
  it('SCH-117: creating a campaign from Arrival gives a setup set whose commits, in order, match the snapshot', async () => {
    const { payloads } = await arrival();
    expect(payloads).toMatchSnapshot();
  });

  it('TRN-056, SCH-112: the root turn has one setup set, origin engine, at the scenario start, waiting for its narration', async () => {
    const { view, db } = await arrival();
    expect(CampaignViewSchema.parse(view)).toEqual(view);
    const point = {
      branchId: view.currentBranchId,
      turnId: view.headTurnId,
      beforeStage: 'end' as const,
    };
    const sets = readSetsForRead(db, point);
    expect(sets.map(({ set }) => [set.stage, set.origin, set.turnId, set.seq])).toEqual([
      ['setup', 'engine', view.headTurnId, 0],
    ]);
    const scenario = readCanon(db, 'scenario', 'scenario.arrival')?.value;
    const setting = readCanon(db, 'setting', 'setting.brinemoor')?.value;
    expect(readTurn(db, view.headTurnId)).toMatchObject({
      parentTurnId: null,
      depth: 0,
      status: 'narrating',
      createdAt: TEST_NOW.toISOString(),
    });
    expect(scenario?.start).toEqual({ year: 1874, month: 10, day: 12, hour: 18, minute: 0 });
    expect(setting?.epoch).toEqual({ year: 1870, month: 1, day: 1, hour: 0, minute: 0 });
  });

  it('SCH-118: folding the setup set yields Wren and Odette at the Gull and Anchor at 18:00 on October 12, 1874', async () => {
    const { deps, db, view, payloads } = await arrival();
    const record = deps.store.readCampaign(db);
    const [setup] = readSetsForRead(db, {
      branchId: view.currentBranchId,
      turnId: view.headTurnId,
      beforeStage: 'end',
    });
    if (setup === undefined) throw new Error('no setup set');
    const calendar = readCanon(db, 'calendar', 'calendar.gregorian')?.value;
    const ruleset = readCanon(db, 'ruleset', 'ruleset.standard')?.value;
    const slots = readCanon(db, 'slots', 'slots.everyday')?.value;
    if (calendar === undefined || ruleset === undefined || slots === undefined) {
      throw new Error('canon is missing');
    }
    const start = initialState({
      pcId: 'pc.wren',
      scenePlaceId: 'place.gull-and-anchor',
      sceneId: record.firstSceneId,
    });
    const { state, conflicts } = fold(start, [setup], { ruleset, slots });
    expect(conflicts).toEqual([]);
    expect(payloads).toContainEqual({
      type: 'scene.start',
      sceneId: record.firstSceneId,
      placeId: 'place.gull-and-anchor',
    });
    const { world } = state;
    expect(world.scenePlaceId).toBe('place.gull-and-anchor');
    expect(world.entities['pc.wren']).toMatchObject({ locationId: 'place.gull-and-anchor' });
    expect(world.entities['npc.odette']).toMatchObject({ locationId: 'place.gull-and-anchor' });
    const date = toDate(
      calendar,
      { year: 1870, month: 1, day: 1, hour: 0, minute: 0 },
      6,
      world.gameTime,
    );
    expect(date).toMatchObject({ year: 1874, month: 10, day: 12, hour: 18, minute: 0 });
    expect(view.gameTimeLabel).toBe('Monday, October 12, 1874 (evening)');
  });

  it('MEM-034, MEM-035: Wren is told both letters and not of the loss; Tomas has it as rumor; only Varek and Jory know their secrets', async () => {
    const { payloads } = await arrival();
    const joryLetter = observationStarting(payloads, 'Jory wrote to his sister Wren');
    const notice = observationStarting(payloads, 'Varek Holm wrote to Wren Ashby');
    const lost = observationStarting(payloads, "The fishing boat Merrow's Luck failed");
    const scuttled = observationStarting(payloads, 'Varek Holm signed false papers');
    const rescued = observationStarting(payloads, "The overloaded Merrow's Luck foundered");
    expect(knowersOf(payloads, joryLetter)).toContainEqual({ entityId: 'pc.wren', via: 'told' });
    expect(knowersOf(payloads, notice)).toContainEqual({ entityId: 'pc.wren', via: 'told' });
    expect(knowersOf(payloads, lost).map(({ entityId }) => entityId)).not.toContain('pc.wren');
    expect(knowersOf(payloads, lost)).toContainEqual({ entityId: 'npc.tomas', via: 'rumor' });
    expect(knowersOf(payloads, scuttled)).toEqual([{ entityId: 'npc.varek', via: 'witnessed' }]);
    expect(knowersOf(payloads, rescued)).toEqual([{ entityId: 'npc.jory', via: 'witnessed' }]);
  });

  it('MEM-010, CON-071: every witness of the reference history has a witnessed grant', async () => {
    const { payloads } = await arrival();
    const observations = payloads.flatMap((payload) =>
      payload.type === 'observation.add' ? [payload.observation] : [],
    );
    expect(observations).toHaveLength(11);
    for (const observation of observations) {
      for (const entityId of observation.witnessIds) {
        expect(knowersOf(payloads, observation)).toContainEqual({ entityId, via: 'witnessed' });
      }
    }
  });

  it('JRN-022: Wren knows Jory and Varek by name and nobody else', async () => {
    const { payloads } = await arrival();
    expect(payloads.filter(({ type }) => type === 'knowledge.name')).toEqual([
      { type: 'knowledge.name', knowerId: 'pc.wren', entityId: 'npc.jory', name: 'Jory Ashby' },
      { type: 'knowledge.name', knowerId: 'pc.wren', entityId: 'npc.varek', name: 'Varek Holm' },
    ]);
  });

  it('TRN-070: a setup set that fails validation is refused with every issue, and leaves no folder', async () => {
    // A tone profile whose slot schema lacks Wren's slots: moving her clothes is GEAR-090's,
    // which arrives in phase 6 (04-content-schemas Open).
    const dataDir = space.folder();
    const packDir = space.copyReferencePack(dataDir);
    const tone = path.join(packDir, 'tone-profiles', 'tone.coastal-mystery.json');
    const text = readFileSync(tone, 'utf8');
    writeFileSync(tone, text.replace('"themeId"', '"slotSchemaId": "slots.simple", "themeId"'));
    const deps = space.deps({ dataDir, sources: space.onlyDataDir(dataDir) });

    const result = await createCampaign(deps, arrivalCommand());
    if (result.ok) throw new Error('expected the setup set to be refused');
    expect(result.error.code).toBe('illegal_state_change');
    const { issues } = result.error.details as { issues: { path: string; message: string }[] };
    expect(issues.length).toBeGreaterThan(1);
    expect(issues.map(({ message }) => message)).toContain('there is no "feet" slot');
    expect(existsSync(deps.store.campaignsDir)).toBe(false);
    expect(await deps.store.listCampaigns()).toEqual([]);
  });

  it('TRN-123: a failure while writing the campaign removes its folder and is rethrown and logged', async () => {
    const deps = space.deps();
    const store = {
      ...deps.store,
      // A connection closed before the transaction makes writeCampaignStart throw.
      createCampaignFolder: async (record: CampaignRecord) => {
        const db = await deps.store.createCampaignFolder(record);
        deps.store.closeCampaign(record.id);
        return db;
      },
    };
    await expect(createCampaign({ ...deps, store }, arrivalCommand())).rejects.toThrow();
    expect(await deps.store.listCampaigns()).toEqual([]);
    expect(deps.logger.entries.map(({ level, message }) => [level, message])).toEqual([
      ['error', 'campaign creation failed'],
    ]);
  });
});

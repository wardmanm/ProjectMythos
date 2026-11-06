import type { Place } from '@mythos/contracts';
import type { ContentSettings } from '@mythos/contracts/content';
import { afterEach, describe, expect, it } from 'vitest';
import { readBranch } from './branches';
import { type CampaignStart, writeCampaignStart } from './campaign-start';
import { readState, readStateHistory } from './campaign-state';
import { readCanon, readTemplates } from './canon';
import { readSetsForRead } from './read-sets';
import {
  countRows,
  createTestSpace,
  newTestCampaign,
  TEST_NOW,
  testBranch,
  testSet,
  testTurn,
} from './testing';
import { readTurn } from './turns';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

const town: Place = {
  id: 'place.town',
  kind: 'place',
  name: 'Town',
  aliases: [],
  tags: [],
  parentPlaceId: null,
  description: '',
};

const settings: ContentSettings = {
  violence: 'moderate',
  gore: 'fade-to-black',
  sexual: 'off',
  language: 'moderate',
  disturbing: 'moderate',
  lines: [],
  veils: ['harm to animals'],
};

function campaignStart(): CampaignStart {
  const turn = { ...testTurn(), status: 'narrating' as const, gameTimeStart: 60 };
  return {
    canon: {
      entries: [{ kind: 'entity', id: town.id, value: town, markdown: null }],
      templates: [{ layer: 'pack', path: 'narrator.md', text: 'Narrate.' }],
    },
    contentSettings: settings,
    branch: testBranch(turn),
    turn,
    sets: [testSet(turn, 'setup', [{ type: 'entity.create', entity: town }])],
    createdAt: TEST_NOW.toISOString(),
  };
}

const TABLES = [
  'canon',
  'canon_templates',
  'campaign_state',
  'turns',
  'commit_sets',
  'commits',
  'branches',
  'branch_turns',
];

describe('writeCampaignStart', () => {
  it('TRN-123: writes canon, the content settings, the current branch, the root turn, and branch Main', async () => {
    const { db } = await newTestCampaign(space);
    const start = campaignStart();
    const [setup] = writeCampaignStart(db, start);

    expect(readCanon(db, 'entity', town.id)?.value).toEqual(town);
    expect(readTemplates(db)).toEqual(start.canon.templates);
    expect(readStateHistory(db, 'content_settings').map(({ value }) => value)).toEqual([settings]);
    expect(readState(db, 'current_branch_id')).toBe(start.branch.id);
    expect(readTurn(db, start.turn.id)).toEqual(start.turn);
    expect(readBranch(db, start.branch.id)).toEqual(start.branch);
    const point = { branchId: start.branch.id, turnId: start.turn.id, beforeStage: 'end' as const };
    expect(readSetsForRead(db, point).map(({ set }) => set)).toEqual([setup]);
  });

  it('TRN-123, ARCH-041: a failure part way through leaves none of it behind', async () => {
    const { db } = await newTestCampaign(space);
    const start = campaignStart();
    const other = testTurn();
    // The set belongs to another turn, which insertRootTurnRows refuses after canon is in.
    const broken = { ...start, sets: [testSet(other, 'setup', [])] };
    expect(() => writeCampaignStart(db, broken)).toThrow(/belongs to turn/);
    for (const table of TABLES) {
      expect(countRows(db, table), table).toBe(0);
    }
  });
});

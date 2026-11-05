import type { ContentSettings } from '@mythos/contracts/content';
import { afterEach, describe, expect, it } from 'vitest';
import { readState, readStateHistory, writeState } from './campaign-state';
import { countRows, createTestSpace, newTestCampaign } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

const settings: ContentSettings = {
  violence: 'moderate',
  gore: 'fade-to-black',
  sexual: 'fade-to-black',
  language: 'moderate',
  disturbing: 'moderate',
  lines: [],
  veils: [],
};

describe('campaign state', () => {
  it('CSET-020: after two content-settings writes, the current value is v2 and the history keeps both', async () => {
    const { db } = await newTestCampaign(space);
    expect(readState(db, 'content_settings')).toBeNull();
    const v2 = { ...settings, gore: 'off' as const, lines: ['harm to animals'] };
    expect(writeState(db, 'content_settings', settings, '2026-11-05T12:00:00.000Z')).toBe(1);
    expect(writeState(db, 'content_settings', v2, '2026-11-05T13:00:00.000Z')).toBe(2);

    expect(readState(db, 'content_settings')).toEqual(v2);
    expect(readStateHistory(db, 'content_settings')).toEqual([
      { version: 1, value: settings, createdAt: '2026-11-05T12:00:00.000Z' },
      { version: 2, value: v2, createdAt: '2026-11-05T13:00:00.000Z' },
    ]);
  });

  it('CTX-005: a template override keeps its version history, separately per template', async () => {
    const { db } = await newTestCampaign(space);
    writeState(db, 'template:narrator.md', 'Narrate tersely.', '2026-11-05T12:00:00.000Z');
    writeState(db, 'template:partials/tone.md', 'Bleak.', '2026-11-05T12:30:00.000Z');
    writeState(db, 'template:narrator.md', 'Narrate warmly.', '2026-11-05T13:00:00.000Z');

    expect(readState(db, 'template:narrator.md')).toBe('Narrate warmly.');
    expect(readStateHistory(db, 'template:narrator.md').map((v) => [v.version, v.value])).toEqual([
      [1, 'Narrate tersely.'],
      [2, 'Narrate warmly.'],
    ]);
    expect(readState(db, 'template:partials/tone.md')).toBe('Bleak.');
  });

  it('TRN-002: writing campaign state adds no commit sets or commits', async () => {
    const { db } = await newTestCampaign(space);
    const before = { sets: countRows(db, 'commit_sets'), commits: countRows(db, 'commits') };
    writeState(db, 'current_branch_id', crypto.randomUUID(), '2026-11-05T12:00:00.000Z');
    writeState(db, 'content_settings', settings, '2026-11-05T12:00:00.000Z');
    expect({ sets: countRows(db, 'commit_sets'), commits: countRows(db, 'commits') }).toEqual(
      before,
    );
  });

  it('CONV-051: a stored value that no longer matches its key’s schema fails at read time', async () => {
    const { db } = await newTestCampaign(space);
    db.prepare(
      `INSERT INTO campaign_state (key, version, value, created_at)
       VALUES ('content_settings', 1, '{"violence": "loud"}', '2026-11-05T12:00:00.000Z')`,
    ).run();
    expect(() => readState(db, 'content_settings')).toThrow(
      /campaign_state row key=content_settings, version=1 is invalid/,
    );
  });
});

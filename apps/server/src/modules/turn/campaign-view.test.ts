import { rmSync } from 'node:fs';
import { CampaignSummarySchema, CampaignViewSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { campaignView, listCampaignSummaries } from './campaign-view';
import { createCampaign } from './create-campaign';
import { arrivalCommand, createTestSpace, TEST_NOW } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

describe('campaign views', () => {
  it("ARCH-045: a campaign's view comes from its own canon, even after its pack folder is deleted", async () => {
    const dataDir = space.folder();
    const packDir = space.copyReferencePack(dataDir);
    const deps = space.deps({ dataDir, sources: space.onlyDataDir(dataDir) });
    const result = await createCampaign(deps, arrivalCommand());
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const created = result.value;

    rmSync(packDir, { recursive: true, force: true });
    deps.store.closeAll();
    const reopened = campaignView(deps.store, created.campaignId);
    expect(reopened).toEqual({ ok: true, value: created });
    expect(CampaignViewSchema.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      campaignId: created.campaignId,
      name: 'Brinemoor',
      settingName: 'Brinemoor',
      gameTimeLabel: 'Monday, October 12, 1874 (evening)',
      lastPlayedAt: TEST_NOW.toISOString(),
      themeId: 'theme.brine',
      contentSettings: { violence: 'moderate', veils: ['harm to animals'] },
      packId: 'reference',
      rulesetId: 'ruleset.standard',
      pcId: 'pc.wren',
      currentBranchId: created.currentBranchId,
      headTurnId: created.headTurnId,
      theme: { id: 'theme.brine' },
    });
  });

  it('ARCH-045: an unknown campaign is not_found', () => {
    const missing = campaignView(space.deps().store, '00000000-0000-4000-8000-00000000ffff');
    expect(missing.ok ? null : missing.error.code).toBe('not_found');
  });

  it("CSET-023: the campaign list shows each campaign's content settings, most recently played first", async () => {
    const deps = space.deps();
    const first = await createCampaign(deps, arrivalCommand({ name: 'First' }));
    const second = await createCampaign(deps, arrivalCommand({ name: 'Second' }));
    if (!first.ok || !second.ok) throw new Error('a campaign was not created');
    // First was played a millisecond later, but as text "…00Z" sorts after "…00.001Z".
    const playedAt = (campaignId: string, at: string) => {
      const opened = deps.store.openCampaign(campaignId);
      if (!opened.ok) throw new Error('the campaign would not open');
      opened.value.prepare('UPDATE campaign SET last_played_at = :at').run({ at });
    };
    playedAt(first.value.campaignId, '2026-11-05T12:00:00.001Z');
    playedAt(second.value.campaignId, '2026-11-05T12:00:00Z');

    const summaries = await listCampaignSummaries(deps.store);
    expect(summaries.map(({ name }) => name)).toEqual(['First', 'Second']);
    for (const summary of summaries) {
      expect(CampaignSummarySchema.strict().parse(summary)).toEqual(summary);
      expect(summary.contentSettings).toEqual(first.value.contentSettings);
    }
  });
});

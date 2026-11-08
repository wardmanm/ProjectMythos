import { describe, expect, it } from 'vitest';
import { campaignPrefixes, isCampaignKey, queryKeys } from './query-keys';

describe('queryKeys', () => {
  it('UI-100: keys are by campaign and branch, as 14-ui §12.1 lists them', () => {
    expect(queryKeys.turns('c1', 'b1')).toEqual(['turns', 'c1', 'b1']);
    expect(queryKeys.turn('c1', 't1')).toEqual(['turn', 'c1', 't1']);
    expect(queryKeys.scene('c1', 'b1')).toEqual(['scene', 'c1', 'b1']);
    expect(queryKeys.sheet('c1', 'npc.varek')).toEqual(['sheet', 'c1', 'npc.varek']);
    expect(queryKeys.journal('c1', 'npc.varek')).toEqual(['journal', 'c1', 'npc.varek']);
    expect(queryKeys.campaign('c1')).toEqual(['campaign', 'c1']);
  });

  it("UI-100: every campaign's key has the campaign second, and the library's has none", () => {
    const keys = [
      queryKeys.campaign('c1'),
      queryKeys.turns('c1', 'b1'),
      queryKeys.turn('c1', 't1'),
      queryKeys.scene('c1', 'b1'),
      queryKeys.sheet('c1', 'pc.wren'),
      queryKeys.journal('c1'),
    ];
    for (const key of keys) expect(isCampaignKey(key, 'c1'), key.join()).toBe(true);
    expect(isCampaignKey(queryKeys.turn('c2', 't1'), 'c1')).toBe(false);
    expect(isCampaignKey(queryKeys.campaigns(), 'c1')).toBe(false);
  });

  it('UI-100: each prefix starts the keys of its kind', () => {
    expect(queryKeys.turns('c1', 'b1').slice(0, 2)).toEqual(campaignPrefixes.turns('c1'));
    expect(queryKeys.scene('c1', 'b1').slice(0, 2)).toEqual(campaignPrefixes.scene('c1'));
    expect(queryKeys.journal('c1', 'x').slice(0, 2)).toEqual(campaignPrefixes.journal('c1'));
  });

  it('UI-100: the machine config has one key, which belongs to no campaign', () => {
    expect(queryKeys.settings()).toEqual(['settings']);
    expect(isCampaignKey(queryKeys.settings(), 'settings')).toBe(false);
  });
});

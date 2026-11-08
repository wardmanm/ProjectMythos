import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { campaignId, otherCampaignId } from '@/test/fixtures';
import { readDraft, writeDraft } from './draft';

describe('draft', () => {
  it("UI-073: the draft is kept per campaign on this device, and an empty one isn't stored", () => {
    writeDraft(campaignId, 'I ask Varek about the ship.');
    expect(readDraft(campaignId)).toBe('I ask Varek about the ship.');
    expect(readDraft(otherCampaignId)).toBe('');
    expect(localStorage.getItem(`mythos.draft.${campaignId}`)).toBe('I ask Varek about the ship.');
    writeDraft(campaignId, '');
    expect(localStorage.getItem(`mythos.draft.${campaignId}`)).toBeNull();
  });

  it('UI-073: storage that throws gives an empty draft and loses nothing else', () => {
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(readDraft(campaignId)).toBe('');
    expect(() => {
      writeDraft(campaignId, 'I wait.');
    }).not.toThrow();
  });
});

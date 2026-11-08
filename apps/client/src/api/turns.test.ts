import { describe, expect, it } from 'vitest';
import { turnsFrom, turnsUrl } from '@/features/play/play-testing';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { branchId, campaignId } from '@/test/fixtures';
import { fetchNewestTurns } from './turns';

const depths = (turns: { turn: { depth: number } }[]) => turns.map((view) => view.turn.depth);

describe('fetchNewestTurns', () => {
  it('UI-100: a window over 200 turns is read 200 at a time back from the head, oldest first', async () => {
    answer('GET', turnsUrl('?limit=200'), { status: 200, body: turnsFrom(100, 299) });
    answer('GET', turnsUrl('?beforeDepth=100&limit=50'), { status: 200, body: turnsFrom(50, 99) });
    const turns = await fetchNewestTurns(campaignId, branchId, 250);
    expect(depths(turns)).toEqual(Array.from({ length: 250 }, (_, index) => 50 + index));
    expect(fetchCalls().map((call) => call.url)).toEqual([
      turnsUrl('?limit=200'),
      turnsUrl('?beforeDepth=100&limit=50'),
    ]);
  });

  it("UI-100: reading stops at the branch's first turn", async () => {
    answer('GET', turnsUrl('?limit=200'), { status: 200, body: turnsFrom(0, 119) });
    const turns = await fetchNewestTurns(campaignId, branchId, 250);
    expect(depths(turns)).toEqual(Array.from({ length: 120 }, (_, index) => index));
    expect(fetchCalls()).toHaveLength(1);
  });
});

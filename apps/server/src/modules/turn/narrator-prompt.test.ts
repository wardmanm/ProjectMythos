// The context module's narrator prompts for the reference campaign, end to end: created by
// createCampaign with seeded IDs, played on with stored turns, and read back through the
// context builder (09-context). It lives here because lint keeps context's tests, like its
// code, from importing the turn module, which creates campaigns.
import path from 'node:path';
import { type ModelProfile, TierReportSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuiltPrompt } from '../context';
import {
  arrivalToPlay,
  narratorPrompt,
  OPENING,
  playThreeTurns,
  profileWith,
  TURNS,
  textOf,
} from './prompt-testing';
import { createTestSpace } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

const arrival = () => arrivalToPlay(space);
const snapshotFile = (name: string) => path.join('__snapshots__', 'narrator-prompt', `${name}.txt`);
const tiny: Partial<ModelProfile> = { contextWindow: 1000, maxOutputTokens: 200 };

describe('the narrator prompt for the reference campaign', () => {
  it('CTX-076, CONV-115, CTX-008: turn zero opens the story from the scenario’s opening file (preview snapshot)', async () => {
    const campaign = await arrival();
    const builder = campaign.builder();
    const point = campaign.point(campaign.rootTurnId);
    const prompt = await narratorPrompt(campaign, campaign.rootTurnId);
    expect(prompt.messages.map(({ role, cacheBreakpoint }) => [role, cacheBreakpoint])).toEqual([
      ['system', undefined],
      ['system', true],
      ['user', true],
      ['user', undefined],
    ]);
    const last = prompt.messages[3]?.content ?? '';
    expect(last).toContain('## The opening');
    expect(last).toContain("Open with Wren's arrival in the taproom");
    expect(last).toContain('Open the story:');
    expect(prompt.tiers.find(({ tier }) => tier === 'transcript')).toEqual({
      tier: 'transcript',
      budget: expect.any(Number) as number,
      estimatedTokens: 0,
      trimmed: [],
      cachedPrefix: false,
    });

    const preview = await builder.preview(point, 'narrator.md');
    if (!preview.ok) throw new Error(preview.error.message);
    await expect(preview.value).toMatchFileSnapshot(snapshotFile('turn-zero'));
    // Every engine partial renders inside it, and previews the same.
    expect(prompt.templates).toEqual([
      'engine:narrator.md',
      'engine:partials/character-public.md',
      'engine:partials/content-settings.md',
      'engine:partials/narration-style.md',
      'engine:partials/pc-sheet.md',
      'engine:partials/tone.md',
      'engine:partials/transcript.md',
    ]);
    expect(await builder.preview(point, 'partials/tone.md')).toEqual(preview);
  });

  it('CONV-115, CTX-008: the third turn’s prompt, with its transcript (preview snapshot)', async () => {
    const campaign = await arrival();
    const turnIds = playThreeTurns(campaign);
    const third = turnIds[2] ?? '';
    const preview = await campaign.builder().preview(campaign.point(third), 'narrator.md');
    if (!preview.ok) throw new Error(preview.error.message);
    await expect(preview.value).toMatchFileSnapshot(snapshotFile('third-turn'));
  });

  it('CTX-101: across three turns in one scene, tiers 1 to 4 change only by appended transcript turns', async () => {
    const campaign = await arrival();
    const turnIds = playThreeTurns(campaign);
    const prompts = [
      await narratorPrompt(campaign, campaign.rootTurnId),
      ...(await Promise.all(turnIds.map((turnId) => narratorPrompt(campaign, turnId)))),
    ];
    const stable = (prompt: BuiltPrompt) => prompt.messages.slice(0, 3);
    for (const prompt of prompts) expect(stable(prompt)).toEqual(stable(prompts[0] ?? prompt));
    const transcripts = prompts.slice(1).map((prompt) => prompt.messages[3]?.content ?? '');
    expect(transcripts[0]).toBe(`## The story so far\n\n${OPENING}`);
    for (const [index, transcript] of transcripts.entries()) {
      if (index === 0) continue;
      const before = transcripts[index - 1] ?? '';
      const turn = TURNS[index - 1];
      expect(transcript).toBe(
        `${before}\n\nPlayer: ${turn?.input ?? ''}\n\n${turn?.narration ?? ''}`,
      );
    }
  });

  it('CTX-102: building the same prompt twice, or in a second campaign made the same way, gives the same bytes', async () => {
    const first = await arrival();
    const second = await arrival();
    const [firstThird] = playThreeTurns(first).slice(2);
    const [secondThird] = playThreeTurns(second).slice(2);
    const a = await narratorPrompt(first, firstThird ?? '');
    const b = await narratorPrompt(first, firstThird ?? '');
    const c = await narratorPrompt(second, secondThird ?? '');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });

  it('CTX-013: a gear change alters only that character’s public block', async () => {
    const campaign = await arrival();
    const [first, second] = playThreeTurns(campaign);
    const before = await narratorPrompt(campaign, second ?? '');
    campaign.edit(first ?? '', [
      {
        type: 'item.move',
        itemId: 'item.carpetbag',
        to: { type: 'placed', placeId: 'place.gull-and-anchor' },
      },
    ]);
    const after = await narratorPrompt(campaign, second ?? '');
    expect(after.messages.slice(0, 2)).toEqual(before.messages.slice(0, 2));
    const beforeLines = (before.messages[2]?.content ?? '').split('\n');
    const afterLines = (after.messages[2]?.content ?? '').split('\n');
    const changed = afterLines.filter((line, index) => line !== beforeLines[index]);
    expect(changed).toEqual([
      "- Wren Ashby, the player's character: Slight and freckled, with dark hair cropped short and a watchful look. Wearing: oilskin cloak, wool trousers, boots.",
    ]);
  });

  it('CTX-052: Odette is only "the innkeeper" until Wren learns her name', async () => {
    const campaign = await arrival();
    const [first, second] = playThreeTurns(campaign);
    const before = textOf(await narratorPrompt(campaign, second ?? ''));
    expect(before).toContain('- the innkeeper: Broad and quick-moving');
    expect(before).not.toContain('Odette');
    campaign.edit(first ?? '', [
      { type: 'knowledge.name', knowerId: 'pc.wren', entityId: 'npc.odette', name: 'Odette' },
    ]);
    const after = textOf(await narratorPrompt(campaign, second ?? ''));
    expect(after).toContain('- Odette: Broad and quick-moving');
    expect(after).not.toContain('Odette Marsh');
  });

  it('CTX-032: a window too small for the fixed tiers fails with context_overflow naming each one', async () => {
    const campaign = await arrival();
    const profile = profileWith(tiny);
    const built = await campaign
      .builder({ profile })
      .narration(campaign.point(campaign.rootTurnId), campaign.rootTurnId, [], null);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.code).toBe('context_overflow');
    for (const tier of ['instructions', 'world', 'turn', 'task']) {
      expect(built.error.message).toMatch(new RegExp(`\\n- ${tier}: \\d+ tokens`));
    }
    expect(built.error.message).toContain('- reserved for the format instruction: 0 tokens');
  });

  it('CTX-090: the inspector gets each tier’s budget, estimate, trims, and cached-prefix flag, and the templates', async () => {
    const campaign = await arrival();
    const [, , third] = playThreeTurns(campaign);
    const prompt = await narratorPrompt(campaign, third ?? '');
    expect(prompt.tiers.map(({ tier }) => tier)).toEqual([
      'instructions',
      'world',
      'scene',
      'transcript',
      'turn',
      'task',
    ]);
    for (const report of prompt.tiers) {
      expect(TierReportSchema.parse(report)).toEqual(report);
      expect(report.estimatedTokens).toBeGreaterThan(0);
      expect(report.estimatedTokens).toBeLessThanOrEqual(report.budget);
    }
    expect(prompt.tiers.map(({ cachedPrefix }) => cachedPrefix)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(prompt.retrieved).toEqual([]);
  });
});

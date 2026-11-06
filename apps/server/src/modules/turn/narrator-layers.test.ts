// The narrator prompt's template layers and locked content, and the context builder's
// other methods, against the reference campaign (09-context §2, 13-content-settings §5).
// It lives here because lint keeps context's tests from importing the turn module.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HARD_FLOOR } from '@mythos/core';
import { afterEach, describe, expect, it } from 'vitest';
import { writeState } from '../storage';
import { arrivalToPlay, count, createdAt, narratorPrompt, textOf } from './prompt-testing';
import { createTestSpace } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

const arrival = (options: Parameters<typeof arrivalToPlay>[1] = {}) =>
  arrivalToPlay(space, options);

describe('template layers and locked content', () => {
  const STRIPPED =
    '<!-- tier: instructions -->\nNarrate.\n<!-- tier: world -->\n<!-- tier: scene -->\n' +
    '<!-- tier: transcript -->\n<!-- tier: turn -->\n{{turn.input}}\n<!-- tier: task -->\nGo.\n';

  it('CTX-005, CTX-106: a campaign override of partials/tone.md wins over the engine’s, and the floor stays', async () => {
    const campaign = await arrival();
    writeState(
      campaign.db,
      'template:partials/tone.md',
      '## Tone\n\nBleak and wet. {{genre}}.\n',
      createdAt,
    );
    const prompt = await narratorPrompt(campaign, campaign.rootTurnId);
    const text = textOf(prompt);
    expect(text).toContain('## Tone\n\nBleak and wet. low-fantasy mystery.');
    expect(text).not.toContain('- Mood:');
    expect(prompt.templates).toContain('campaign:partials/tone.md');
    expect(count(text, HARD_FLOOR)).toBe(1);
  });

  it('CTX-007, CSET-040, CSET-046, CSET-062: a campaign narrator.md that drops everything still gets the floor', async () => {
    const campaign = await arrival();
    writeState(campaign.db, 'template:narrator.md', STRIPPED, createdAt);
    const prompt = await narratorPrompt(campaign, campaign.rootTurnId);
    expect(prompt.messages[0]?.content).toBe(`Narrate.\n\n${HARD_FLOOR}`);
    expect(count(textOf(prompt), HARD_FLOOR)).toBe(1);
  });

  it('CTX-005, CSET-046, CSET-062: a model profile’s templates are layer 2, and the floor stays', async () => {
    const campaign = await arrival();
    const profileDir = space.folder();
    writeFileSync(
      path.join(profileDir, 'narrator.md'),
      STRIPPED.replace('Narrate.', 'Narrate bluntly.'),
    );
    const prompt = await narratorPrompt(campaign, campaign.rootTurnId, { profileDir });
    expect(prompt.messages[0]?.content).toBe(`Narrate bluntly.\n\n${HARD_FLOOR}`);
    expect(prompt.templates).toEqual(['model-profile:narrator.md']);
  });

  it('CSET-046, CSET-062, SCH-023: a pack tone profile’s templates are used, and the floor stays', async () => {
    const dataDir = space.folder();
    const packDir = space.copyReferencePack(dataDir);
    const toneTemplates = path.join(packDir, 'tone-profiles', 'tone.coastal-mystery', 'templates');
    mkdirSync(path.join(toneTemplates, 'partials'), { recursive: true });
    writeFileSync(
      path.join(toneTemplates, 'partials', 'narration-style.md'),
      'Write like a ghost story.\n',
    );
    const campaign = await arrival({ dataDir, sources: space.onlyDataDir(dataDir) });
    const prompt = await narratorPrompt(campaign, campaign.rootTurnId);
    const text = textOf(prompt);
    expect(text).toContain('Write like a ghost story.');
    expect(prompt.templates).toContain('tone-profile:partials/narration-style.md');
    expect(count(text, HARD_FLOOR)).toBe(1);
  });

  it('CSET-012: the narrator prompt carries the content settings', async () => {
    const campaign = await arrival();
    const text = textOf(await narratorPrompt(campaign, campaign.rootTurnId));
    expect(text).toContain('## Content\n\n- Violence:');
  });

  it('CSET-046, CSET-062: with Pip present the floor appears twice, the task tier ends with it, and sexual is off', async () => {
    const dataDir = space.folder();
    const packDir = space.copyReferencePack(dataDir);
    const scenarioFile = path.join(packDir, 'scenarios', 'scenario.arrival.json');
    const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8')) as {
      presentEntityIds: string[];
    };
    scenario.presentEntityIds = ['npc.odette', 'npc.pip'];
    writeFileSync(scenarioFile, JSON.stringify(scenario));
    const campaign = await arrival({ dataDir, sources: space.onlyDataDir(dataDir) });
    const prompt = await narratorPrompt(campaign, campaign.rootTurnId);
    const text = textOf(prompt);
    expect(count(text, HARD_FLOOR)).toBe(2);
    expect(prompt.messages.at(-1)?.content.endsWith(HARD_FLOOR)).toBe(true);
    expect(text).toContain('- Sexual: No sexual content.');
    expect(text).toContain('- the errand girl: Small and wiry');
  });
});

describe('the builder', () => {
  it('CTX-110: not_configured from the composition root is passed through', async () => {
    const campaign = await arrival();
    const builder = campaign.builder({ notConfigured: true });
    const point = campaign.point(campaign.rootTurnId);
    expect(await builder.narration(point, campaign.rootTurnId, [], null)).toEqual({
      ok: false,
      error: { code: 'not_configured', message: 'No model profile is assigned to narrator.' },
    });
    expect((await builder.preview(point, 'narrator.md')).ok).toBe(false);
  });

  it('CTX-110: builders that arrive later return an error naming their phase', async () => {
    const campaign = await arrival();
    const builder = campaign.builder();
    const point = campaign.point(campaign.rootTurnId);
    const turnId = campaign.rootTurnId;
    const failures = [
      [await builder.adjudication(point, turnId, null), 3],
      [await builder.npcVoice(point, turnId, 'npc.odette', []), 4],
      [await builder.extraction(point, turnId), 4],
      [await builder.suggestions(point, turnId), 3],
      [await builder.transcriptSummary(point, [turnId]), 2],
      [await builder.consolidation(point, [], []), 4],
      [await builder.narration(point, turnId, [], 'Make it darker.'), 2],
      [
        await builder.narration(
          point,
          turnId,
          [{ speakerId: 'npc.odette', voice: { lines: [{ says: 'Evening.', does: null }] } }],
          null,
        ),
        4,
      ],
    ] as const;
    for (const [result, phase] of failures) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toContain(`phase ${String(phase)}`);
      }
    }
    await expect(builder.keySpeakers(point, turnId)).rejects.toThrow('phase 4');
  });

  it('CTX-008: a preview names a template file, never a path outside the layers', async () => {
    const campaign = await arrival();
    const builder = campaign.builder();
    const point = campaign.point(campaign.rootTurnId);
    expect((await builder.preview(point, '../machine-config.json')).ok).toBe(false);
    const bad = await builder.preview(point, '../secrets.md');
    expect(bad.ok ? null : bad.error.code).toBe('validation_failed');
    const unused = await builder.preview(point, 'adjudicator.md');
    expect(unused.ok ? null : unused.error).toEqual({
      code: 'not_found',
      message: 'No phase-1 prompt uses adjudicator.md.',
    });
  });
});

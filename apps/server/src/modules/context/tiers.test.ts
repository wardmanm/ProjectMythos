import { ok, type Tier } from '@mythos/contracts';
import { estimateTokens, HARD_FLOOR } from '@mythos/core';
import { describe, expect, it } from 'vitest';
import { layOut, splitTiers, type TierTexts, withLockedContent } from './tiers';

const NARRATOR_TIERS: readonly Tier[] = [
  'instructions',
  'world',
  'scene',
  'transcript',
  'turn',
  'task',
];

describe('tier markers', () => {
  const marked = (names: readonly string[]) =>
    names.map((name) => `<!-- tier: ${name} -->\n${name} text\n`).join('\n');

  it('CTX-003: the rendered template splits at its markers, each tier trimmed', () => {
    const rendered = `\n\n${marked(NARRATOR_TIERS)}\n\n`;
    expect(splitTiers(rendered, NARRATOR_TIERS)).toEqual(
      ok({
        instructions: 'instructions text',
        world: 'world text',
        scene: 'scene text',
        transcript: 'transcript text',
        turn: 'turn text',
        task: 'task text',
      }),
    );
  });

  it('CTX-003: a tier may be empty, and a marker may have extra spaces', () => {
    const rendered =
      '<!--tier:instructions-->\nI\n<!--   tier: world   -->\n<!-- tier: scene -->\n' +
      '<!-- tier: transcript -->\n\n\n<!-- tier: turn -->\nT\n<!-- tier: task -->\nK';
    const result = splitTiers(rendered, NARRATOR_TIERS);
    expect(result).toEqual(
      ok({ instructions: 'I', world: '', scene: '', transcript: '', turn: 'T', task: 'K' }),
    );
  });

  it.each([
    [
      'missing',
      marked(['instructions', 'world', 'scene', 'turn', 'task']),
      'no marker starts the transcript tier',
    ],
    ['repeated', marked([...NARRATOR_TIERS, 'world']), 'the world tier starts twice'],
    [
      'out of order',
      marked(['instructions', 'scene', 'world', 'transcript', 'turn', 'task']),
      'the world tier starts after the scene tier',
    ],
    [
      'unknown',
      marked([...NARRATOR_TIERS.slice(0, 4), 'state', 'turn', 'task']),
      '"state" is not a tier of this prompt',
    ],
    [
      'after text',
      `A note.\n${marked(NARRATOR_TIERS)}`,
      'there is text before the first tier marker',
    ],
  ])('CTX-003: a %s marker fails', (_, rendered, problem) => {
    const result = splitTiers(rendered, NARRATOR_TIERS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(problem);
  });
});

describe('locked content', () => {
  const texts: TierTexts = { instructions: 'Narrate.\n', task: 'Write the narration.' };

  it('CTX-007, CSET-040: the floor ends the instructions tier, once, with no minor present', () => {
    const locked = withLockedContent(texts, 'narrator', false);
    expect(locked.instructions).toBe(`Narrate.\n\n${HARD_FLOOR}`);
    expect(locked.task).toBe('Write the narration.');
  });

  it('CSET-042: with a minor present, the floor also ends the task tier', () => {
    const locked = withLockedContent(texts, 'narrator', true);
    expect(locked.task).toBe(`Write the narration.\n\n${HARD_FLOOR}`);
  });
});

describe('message layout', () => {
  const texts: TierTexts = {
    instructions: 'I',
    world: 'WW',
    scene: 'SSS',
    transcript: 'TTTT',
    state: '',
    knowledge: '',
    turn: 'UUUUU',
    task: 'KKKKKK',
  };

  it('CTX-010: tiers go in five messages, with cache breakpoints after world, scene, and transcript', () => {
    expect(layOut(texts, 1).messages).toEqual([
      { role: 'system', content: 'I' },
      { role: 'system', content: 'WW', cacheBreakpoint: true },
      { role: 'user', content: 'SSS', cacheBreakpoint: true },
      { role: 'user', content: 'TTTT', cacheBreakpoint: true },
      { role: 'user', content: 'UUUUU\n\nKKKKKK' },
    ]);
  });

  it('CTX-010: an empty tier adds no message, and the tiers before the last breakpoint are the cached prefix', () => {
    const layout = layOut({ ...texts, transcript: '' }, 1);
    expect(layout.messages.map((message) => message.content)).toEqual([
      'I',
      'WW',
      'SSS',
      'UUUUU\n\nKKKKKK',
    ]);
    expect([...layout.cached]).toEqual(['instructions', 'world', 'scene']);
  });

  it('PRV-072: each tier counts the separator before it, so the tiers add up to at least the whole prompt', () => {
    const layout = layOut(texts, 3.5);
    expect(layout.tokens).toEqual({
      instructions: 1,
      world: 1,
      scene: 1,
      transcript: 2,
      turn: 2,
      task: 3,
    });
    const whole = estimateTokens(layout.messages.map((message) => message.content).join(''), 3.5);
    const sum = Object.values(layout.tokens).reduce((total, tokens) => total + tokens, 0);
    expect(sum).toBeGreaterThanOrEqual(whole);
  });
});

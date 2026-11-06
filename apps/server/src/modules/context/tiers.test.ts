import {
  type AppError,
  type ModelProfile,
  ModelProfileSchema,
  ok,
  type Result,
  type Tier,
  TierReportSchema,
} from '@mythos/contracts';
import { estimateTokens, HARD_FLOOR } from '@mythos/core';
import { describe, expect, it } from 'vitest';
import { type FitChoice, type FitInput, type FittedPrompt, fitPrompt } from './budget';
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

/** A profile with `contextWindow` tokens and 100 for output. */
function profileWith(
  contextWindow: number,
  contextBudget: Record<string, number> = {},
): ModelProfile {
  return ModelProfileSchema.parse({
    id: 'test-profile',
    providerId: 'mock',
    model: 'mock-model',
    kind: 'text',
    contextWindow,
    maxOutputTokens: 100,
    structuredOutput: 'json-schema',
    contextBudget,
  });
}

/** `count` turns of `size` characters each. */
const sizes = (count: number, size: number): number[] => Array.from({ length: count }, () => size);

/** A prompt made of letters, one character per token, so sizes read as tokens. */
type FakePrompt = {
  fixed: number;
  /** The scene's parts; each trim removes the first part left. */
  sceneParts: string[];
  turns: number[];
  /** Added to the transcript when it holds more than one turn, as a template might. */
  transcriptHeader?: string;
};

function fitInput(
  prompt: FakePrompt,
  profile: ModelProfile,
  reservedTokens = 0,
  charsPerToken = 1,
): FitInput {
  const render = (choice: FitChoice): Result<TierTexts, AppError> => {
    const { from, to } = choice.transcript;
    const turns = prompt.turns
      .slice(from, to)
      .map((size, index) => String(from + index).padEnd(size, 't'));
    const header = turns.length > 1 ? (prompt.transcriptHeader ?? '') : '';
    return ok({
      instructions: 'i'.repeat(prompt.fixed),
      world: 'w'.repeat(prompt.fixed),
      scene: prompt.sceneParts.slice(choice.sceneTrims).join(''),
      transcript: header + turns.join('\n\n'),
      turn: 'u'.repeat(prompt.fixed),
      task: 'k'.repeat(prompt.fixed),
    });
  };
  return {
    role: 'narrator',
    tiers: NARRATOR_TIERS,
    weights: { scene: 15, transcript: 45 },
    profile,
    charsPerToken,
    reservedTokens,
    sceneTrims: prompt.sceneParts.slice(0, -1).map((_, index) => `trim ${String(index + 1)}`),
    transcriptTurns: prompt.turns.length,
    chunkTurns: 8,
    render,
  };
}

function fitted(input: FitInput): FittedPrompt {
  const result = fitPrompt(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const report = (prompt: FittedPrompt, tier: Tier) =>
  prompt.tiers.find((each) => each.tier === tier);
const transcriptOf = (prompt: FittedPrompt) =>
  prompt.messages.find((message, index) => index === 3 && message.cacheBreakpoint)?.content ?? '';

describe('budgets', () => {
  it('CTX-030: the input budget is the window less output tokens, less 10%, and the fixed tiers may fill it', () => {
    // floor((1211 − 100) × 0.9) = 999; four fixed tiers of 249 and separators of 2 make 998.
    const prompt = { fixed: 249, sceneParts: [''], turns: [] };
    expect(fitPrompt(fitInput(prompt, profileWith(1211))).ok).toBe(true);
    expect(fitPrompt(fitInput({ ...prompt, fixed: 250 }, profileWith(1211))).ok).toBe(false);
  });

  it('CTX-031, CTX-033: fixed tiers get what they need; scene and transcript share the rest by weight, and spill', () => {
    // 10,000 budget; fixed 4 × 1,000 + 2 for the separator; 5,998 left: scene 1,499, transcript 4,498.
    const profile = profileWith(Math.ceil(10_000 / 0.9) + 100);
    const small = fitted(
      fitInput({ fixed: 1000, sceneParts: ['s'.repeat(300)], turns: [6000] }, profile),
    );
    expect(report(small, 'instructions')?.budget).toBe(1000);
    expect(report(small, 'scene')).toMatchObject({ budget: 300, estimatedTokens: 300 });
    // The scene needed less than its share, so the transcript took the rest.
    expect(report(small, 'transcript')?.budget).toBe(5998 - 300);
  });

  it('CTX-031: a profile cap limits a trimmable tier', () => {
    const profile = profileWith(20_000, { 'narrator.transcript': 250, 'narrator.task': 1 });
    const prompt = fitted(
      fitInput({ fixed: 10, sceneParts: ['s'], turns: sizes(20, 100) }, profile),
    );
    expect(report(prompt, 'transcript')?.budget).toBe(250);
    expect(report(prompt, 'transcript')?.estimatedTokens).toBeLessThanOrEqual(250);
    // A cap on a fixed tier has no effect.
    expect(report(prompt, 'task')?.budget).toBe(12);
  });

  it('CTX-032: fixed tiers too big for the window fail with context_overflow, naming each and the reservation', () => {
    const result = fitPrompt(
      fitInput({ fixed: 600, sceneParts: ['s'], turns: [10] }, profileWith(2000), 40),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('context_overflow');
    expect(result.error.message).toBe(
      'The narrator prompt does not fit model profile "test-profile". A 2000-token context window, ' +
        'less 100 output tokens and a 10% margin, leaves 1710 tokens for input, and the fixed tiers ' +
        'need 2442:\n- instructions: 600 tokens\n- world: 600 tokens\n- turn: 600 tokens\n' +
        '- task: 602 tokens\n- reserved for the format instruction: 40 tokens\n' +
        'Use a model profile with a larger context window or fewer output tokens.',
    );
  });

  it('CTX-034: an over-budget scene loses its trims in order until it fits, and the report lists them', () => {
    // 1,000 budget; fixed 4 × 50 + 2; scene share 15/60 of 798 = 199.
    const profile = profileWith(Math.ceil(1000 / 0.9) + 100);
    const parts = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(150)];
    const prompt = fitted(
      fitInput({ fixed: 50, sceneParts: parts, turns: sizes(10, 80) }, profile),
    );
    expect(report(prompt, 'scene')).toMatchObject({
      budget: 199,
      estimatedTokens: 150,
      trimmed: ['trim 1', 'trim 2'],
    });
  });

  it('CTX-034: a scene still over its share at its last trim is kept whole, and the transcript makes up the difference', () => {
    const profile = profileWith(Math.ceil(1000 / 0.9) + 100);
    const parts = ['a'.repeat(100), 'b'.repeat(400)];
    const prompt = fitted(
      fitInput({ fixed: 50, sceneParts: parts, turns: sizes(10, 80) }, profile),
    );
    expect(report(prompt, 'scene')).toMatchObject({
      budget: 400,
      estimatedTokens: 400,
      trimmed: ['trim 1'],
    });
    // 798 − 400 = 398 for the transcript, which keeps the newest chunk of two turns.
    expect(report(prompt, 'transcript')).toMatchObject({ budget: 398, estimatedTokens: 162 });
    expect(report(prompt, 'transcript')?.trimmed).toEqual([
      "the scene's first 8 turns (no summary yet)",
    ]);
  });

  it('CTX-032: when even the trimmed scene does not fit, the overflow lists it with the fixed tiers', () => {
    const profile = profileWith(Math.ceil(1000 / 0.9) + 100);
    const result = fitPrompt(
      fitInput({ fixed: 50, sceneParts: ['a', 's'.repeat(900)], turns: [] }, profile),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('the fixed tiers and the trimmed scene need');
      expect(result.error.message).toContain('- scene (fully trimmed): 900 tokens');
    }
  });

  it('CTX-041: the transcript rolls by whole chunks, and grows only at the end between rolls', () => {
    const profile = profileWith(Math.ceil(2000 / 0.9) + 100);
    const prefixChanges: number[] = [];
    let previous = '';
    for (let turns = 1; turns <= 60; turns += 1) {
      const prompt = fitted(
        fitInput({ fixed: 10, sceneParts: ['s'], turns: sizes(turns, 60) }, profile),
      );
      const transcript = transcriptOf(prompt);
      expect(report(prompt, 'transcript')?.estimatedTokens).toBeLessThanOrEqual(
        report(prompt, 'transcript')?.budget ?? 0,
      );
      if (!transcript.startsWith(previous)) prefixChanges.push(turns);
      previous = transcript;
    }
    // 2,000 budget; fixed 42; the scene takes 1 and spills the rest: 1,956 tokens of
    // transcript hold 31 turns of 60 and their separators. It rolls a chunk at 32, 40, ...
    expect(prefixChanges).toEqual([32, 40, 48, 56]);
  });

  it('CTX-041: a tail a template made bigger than its turns rolls again until it fits', () => {
    const profile = profileWith(Math.ceil(2000 / 0.9) + 100);
    const turns = sizes(24, 60);
    expect(
      report(fitted(fitInput({ fixed: 10, sceneParts: ['s'], turns }, profile)), 'transcript')
        ?.trimmed,
    ).toEqual([]);
    // Each turn alone has no header, so all 24 seem to fit; with it they do not.
    const header = 'h'.repeat(600);
    const prompt = fitted(
      fitInput({ fixed: 10, sceneParts: ['s'], turns, transcriptHeader: header }, profile),
    );
    const transcript = report(prompt, 'transcript');
    expect(transcript?.estimatedTokens).toBeLessThanOrEqual(transcript?.budget ?? 0);
    expect(transcript?.trimmed).toEqual(["the scene's first 8 turns (no summary yet)"]);
  });

  it('PRV-072: over many window sizes, input plus the reservation plus output never exceeds the window', () => {
    for (let window = 300; window <= 30_000; window += 97) {
      for (const reserved of [0, 50, 2430]) {
        const profile = profileWith(window);
        const input = fitInput(
          {
            fixed: 70,
            sceneParts: ['p'.repeat(90), 'a'.repeat(200), 'n'.repeat(40)],
            turns: sizes(40, 350),
          },
          profile,
          reserved,
          3.5,
        );
        const result = fitPrompt(input);
        if (!result.ok) {
          expect(result.error.code).toBe('context_overflow');
          continue;
        }
        const sent = result.value.messages.map((message) => message.content).join('');
        expect(estimateTokens(sent, 3.5) + reserved + profile.maxOutputTokens).toBeLessThanOrEqual(
          window,
        );
      }
    }
  });

  it('PRV-072: the reservation comes off the input budget before the tiers share it', () => {
    const profile = profileWith(Math.ceil(2000 / 0.9) + 100);
    const prompt = { fixed: 10, sceneParts: ['s'], turns: sizes(40, 60) };
    const without = report(fitted(fitInput(prompt, profile)), 'transcript')?.budget ?? 0;
    const withReserve = report(fitted(fitInput(prompt, profile, 500)), 'transcript')?.budget ?? 0;
    expect(without - withReserve).toBe(500);
  });

  it('CTX-090: each tier reports its budget, estimate, what was trimmed, and whether it is cached', () => {
    const profile = profileWith(Math.ceil(1000 / 0.9) + 100);
    const parts = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(150)];
    const prompt = fitted(
      fitInput({ fixed: 50, sceneParts: parts, turns: sizes(10, 80) }, profile),
    );
    for (const tier of prompt.tiers) expect(TierReportSchema.parse(tier)).toEqual(tier);
    expect(prompt.tiers.map(({ tier, cachedPrefix }) => [tier, cachedPrefix])).toEqual([
      ['instructions', true],
      ['world', true],
      ['scene', true],
      ['transcript', true],
      ['turn', false],
      ['task', false],
    ]);
    expect(report(prompt, 'turn')).toEqual({
      tier: 'turn',
      budget: 50,
      estimatedTokens: 50,
      trimmed: [],
      cachedPrefix: false,
    });
  });
});

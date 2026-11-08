import { describe, expect, it } from 'vitest';
import { budgetWords, duration, tokens } from './call-words';

describe('call words', () => {
  it('UI-090: durations read in milliseconds, seconds, or minutes', () => {
    expect(duration(850)).toBe('850 ms');
    expect(duration(3200)).toBe('3.2 s');
    expect(duration(61_060)).toBe('1 min 1 s');
    expect(duration(125_400)).toBe('2 min 5 s');
  });

  it('UI-090: tokens in and out have separators, and missing counts say so', () => {
    expect(tokens(1204, 312)).toBe('1,204 in · 312 out');
    expect(tokens(null, null)).toBe('Not reported');
    expect(tokens(1204, null)).toBe('1,204 in · not reported out');
  });

  it('UI-090, UI-114: a budget is in words, and over budget says so', () => {
    expect(budgetWords(1204, 4000)).toBe('1,204 of 4,000 tokens');
    expect(budgetWords(340, 300)).toBe('340 of 300 tokens, over budget');
  });
});

import { ErrorCodeSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import type { ApiFailure } from './api-failure';
import { plainWords } from './plain-words';

const failures: [string, ApiFailure][] = [
  ...ErrorCodeSchema.options.map((code): [string, ApiFailure] => [
    code,
    { kind: 'server', status: 500, error: { code, message: `raw ${code}` } },
  ]),
  ['unreachable', { kind: 'unreachable', detail: 'TypeError: Failed to fetch' }],
  ['invalid-response', { kind: 'invalid-response', detail: 'currentBranchId: Invalid UUID' }],
];

describe('plainWords', () => {
  it('UI-122: each failure kind says what happened and what to do, never its code', () => {
    for (const [code, failure] of failures) {
      const words = plainWords(failure);
      const sentences = words.split(/(?<=\.) /);
      expect(sentences.length, code).toBeGreaterThanOrEqual(2);
      expect(words, code).not.toContain(code);
      expect(words, code).not.toMatch(/sorry|apolog/i);
      expect(words, code).not.toContain('raw ');
    }
  });

  it('UI-102, UI-122: a conflict says the campaign changed on another device', () => {
    const conflict: ApiFailure = {
      kind: 'server',
      status: 409,
      error: { code: 'conflict', message: 'stale head' },
    };
    expect(plainWords(conflict)).toBe(
      'This campaign changed on another device. Showing the latest.',
    );
  });
});

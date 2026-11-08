import type { ContentSettings } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { contentSummary } from './content-summary';

const settings: ContentSettings = {
  violence: 'moderate',
  gore: 'fade-to-black',
  sexual: 'off',
  language: 'explicit',
  disturbing: 'moderate',
  lines: [],
  veils: [],
};

describe('contentSummary', () => {
  it("CSET-023: the summary gives every category's level, in the glossary's words", () => {
    expect(contentSummary(settings)).toBe(
      'Violence moderate, gore fade to black, sexual content off, language explicit, disturbing themes moderate',
    );
  });

  it('CSET-023: then it counts lines and veils, and never shows their topics', () => {
    const summary = contentSummary({
      ...settings,
      lines: ['harm to animals'],
      veils: ['torture', 'drowning'],
    });
    expect(summary).toMatch(/; 1 line, 2 veils$/);
    expect(summary).not.toContain('torture');
    expect(contentSummary({ ...settings, lines: [], veils: ['torture'] })).toMatch(
      /; 0 lines, 1 veil$/,
    );
  });
});

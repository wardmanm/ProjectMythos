import { describe, expect, it } from 'vitest';
import { wholeSentences } from './sentences';

describe('wholeSentences', () => {
  it('UI-053, UI-112: a sentence is whole once the space after its stop has arrived', () => {
    expect(wholeSentences('The fog has followed you in')).toBe('');
    expect(wholeSentences('The fog has followed you in.')).toBe('');
    expect(wholeSentences('The fog has followed you in. Varek')).toBe(
      'The fog has followed you in.',
    );
    expect(wholeSentences('Who? Not me! Wait… then')).toBe('Who? Not me! Wait…');
  });

  it('UI-053, UI-112: closing quotes and brackets belong to the sentence they close', () => {
    expect(wholeSentences('"Stay a while." He')).toBe('"Stay a while."');
    expect(wholeSentences('“Stay?” He')).toBe('“Stay?”');
    expect(wholeSentences('(He laughs.) Then')).toBe('(He laughs.)');
  });

  it('UI-053, UI-112: a paragraph break ends a sentence that has no stop', () => {
    expect(wholeSentences('A heading of sorts\n\nThe fog')).toBe('A heading of sorts');
    expect(wholeSentences('One.\n\nTwo')).toBe('One.');
  });

  it('UI-053, UI-112: a stop inside a number or a word does not end a sentence', () => {
    expect(wholeSentences('It costs 3.5 crowns')).toBe('');
    expect(wholeSentences('Ask at harbor.office later')).toBe('');
  });
});

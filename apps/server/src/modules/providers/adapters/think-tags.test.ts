import { describe, expect, it } from 'vitest';
import { createThinkTagSplitter, type ThinkSplit } from './think-tags';

/** Pushes each delta through a new splitter, then ends it; returns every split, in order. */
function splitAll(deltas: readonly string[]): ThinkSplit[] {
  const splitter = createThinkTagSplitter();
  return [...deltas.map((delta) => splitter.push(delta)), splitter.end()];
}

function joined(splits: readonly ThinkSplit[]): ThinkSplit {
  return {
    answer: splits.map((split) => split.answer).join(''),
    thinking: splits.map((split) => split.thinking).join(''),
  };
}

describe('createThinkTagSplitter', () => {
  it('PRV-046: text with no tags is all answer, passed on as it arrives', () => {
    const splits = splitAll(['The rain ', 'keeps falling.']);
    expect(splits.map((split) => split.answer)).toEqual(['The rain ', 'keeps falling.', '']);
    expect(joined(splits).thinking).toBe('');
  });

  it('PRV-046: a think block is thinking, and the tags are neither', () => {
    expect(joined(splitAll(['<think>Is the door locked?</think>The door opens.']))).toEqual({
      answer: 'The door opens.',
      thinking: 'Is the door locked?',
    });
  });

  it('PRV-046: whitespace straight after a closing tag is dropped, even in a later delta', () => {
    expect(joined(splitAll(['<think>plan</think>', '\n\n', 'The door opens.']))).toEqual({
      answer: 'The door opens.',
      thinking: 'plan',
    });
  });

  it('PRV-046: a tag split across deltas never leaks into the answer', () => {
    const splits = splitAll(['<thi', 'nk>weigh the odds</th', 'ink>\n\nThe lock ', 'gives.']);
    for (const split of splits) expect(split.answer).not.toMatch(/[<>]/);
    expect(joined(splits)).toEqual({ answer: 'The lock gives.', thinking: 'weigh the odds' });
  });

  it('PRV-046: splitting the output at any point gives the same answer and thinking', () => {
    const output = 'Before <think>first</think> middle <think>second</think>after.';
    const whole = joined(splitAll([output]));
    expect(whole).toEqual({ answer: 'Before middle after.', thinking: 'firstsecond' });
    for (let at = 1; at < output.length; at += 1) {
      const splits = splitAll([output.slice(0, at), output.slice(at)]);
      expect(joined(splits)).toEqual(whole);
      for (const split of splits) expect(split.answer).not.toMatch(/[<>]/);
    }
  });

  it('PRV-046: one character at a time gives the same result', () => {
    const output = '<think>a < b</think>Answer.';
    expect(joined(splitAll(Array.from(output)))).toEqual({ answer: 'Answer.', thinking: 'a < b' });
  });

  it('PRV-046: a held-back "<" that starts no tag is passed on with the next delta', () => {
    const splits = splitAll(['2 <', ' 3, and <b>bold</b>']);
    expect(splits.map((split) => split.answer)).toEqual(['2 ', '< 3, and <b>bold</b>', '']);
  });

  it('PRV-046: end passes on a partial tag left at the end as text', () => {
    const splits = splitAll(['Then <thi']);
    expect(splits.map((split) => split.answer)).toEqual(['Then ', '<thi']);
  });

  it('PRV-046: a block still open at the end is thinking', () => {
    expect(joined(splitAll(['Answer. <think>never closed', ' </thi']))).toEqual({
      answer: 'Answer. ',
      thinking: 'never closed </thi',
    });
  });

  it('PRV-046: a stray closing tag is dropped', () => {
    expect(joined(splitAll(['reasoning</think>', 'The answer.']))).toEqual({
      answer: 'reasoningThe answer.',
      thinking: '',
    });
  });

  it('PRV-046: an opening tag inside a block is thinking text', () => {
    expect(joined(splitAll(['<think>say <think> here</think>done']))).toEqual({
      answer: 'done',
      thinking: 'say <think> here',
    });
  });
});

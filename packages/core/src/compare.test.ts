import { describe, expect, it } from 'vitest';
import { cmp } from './compare';

describe('cmp', () => {
  it('CONV-087: puts uppercase before lowercase, as code points do', () => {
    expect(['b', 'a', 'B', 'A'].sort(cmp)).toEqual(['A', 'B', 'a', 'b']);
  });

  it('CONV-087: puts accented letters after every ASCII letter', () => {
    expect(['é', 'z', 'e'].sort(cmp)).toEqual(['e', 'z', 'é']);
  });

  it('CONV-087: puts characters beyond U+FFFF after U+E000 to U+FFFF, unlike <', () => {
    // Typed as string, not as literals, so lint doesn't evaluate `<` at compile time.
    const astral: string = '😀'; // U+1F600
    const fullwidthTilde: string = '～'; // U+FF5E
    expect(astral < fullwidthTilde).toBe(true); // what plain < gets wrong
    expect(cmp(astral, fullwidthTilde)).toBe(1);
    expect(cmp(fullwidthTilde, astral)).toBe(-1);
    expect([astral, fullwidthTilde, 'a'].sort(cmp)).toEqual(['a', fullwidthTilde, astral]);
  });

  it('CONV-087: equal strings give 0, and a prefix comes first', () => {
    expect(cmp('harbor', 'harbor')).toBe(0);
    expect(cmp('', '')).toBe(0);
    expect(cmp('harbor', 'harbormaster')).toBe(-1);
    expect(cmp('harbormaster', 'harbor')).toBe(1);
    expect(cmp('😀', '😀x')).toBe(-1);
  });
});

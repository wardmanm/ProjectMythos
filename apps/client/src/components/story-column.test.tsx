import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StoryColumn } from './story-column';

describe('StoryColumn', () => {
  it("UI-040: the story is left-aligned, never justified, at most the theme's measure wide, and centered", () => {
    render(
      <StoryColumn>
        <p>The fog has followed you in.</p>
      </StoryColumn>,
    );
    // jsdom does no layout, so this reads the classes that set the alignment and width.
    const classes = (
      screen.getByText('The fog has followed you in.').parentElement?.className ?? ''
    ).split(' ');
    expect(classes).toContain('text-left');
    expect(classes).not.toContain('text-justify');
    expect(classes).toContain('max-w-(--narration-measure)');
    expect(classes).toContain('mx-auto');
    expect(classes).toContain('font-narration');
  });
});

import type { ReactNode } from 'react';

/**
 * The column the story is read in. Implements UI-040: left-aligned, never justified, at
 * most the theme's measure wide, and centered in its area. Size, line height, and measure
 * come from the theme's variables (UI-032).
 */
export function StoryColumn({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-(--narration-measure) px-4 text-left font-narration text-(length:--narration-size) leading-(--narration-line-height) text-text">
      {children}
    </div>
  );
}

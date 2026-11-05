// Implements UI-034: the faces ship with the app as @fontsource packages, so nothing loads
// from the network. Phase 1 bundles the two faces theme.house names; the other eight in
// BUNDLED_FONTS arrive with the themes that use them (14-ui Open).
import '@fontsource/literata/400.css';
import '@fontsource/literata/400-italic.css';
import '@fontsource/literata/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import '@fontsource/atkinson-hyperlegible/700.css';

/** A bundled face: its CSS family name, and the generic family to fall back to. */
type BundledFace = { cssFamily: string; fallback: 'serif' | 'sans-serif' };

/** The faces imported above, by the slug a theme's `FontRef.family` names. */
export const bundledFaces: ReadonlyMap<string, BundledFace> = new Map([
  ['literata', { cssFamily: 'Literata', fallback: 'serif' }],
  ['atkinson-hyperlegible', { cssFamily: 'Atkinson Hyperlegible', fallback: 'sans-serif' }],
]);

/**
 * The CSS `font-family` value for a theme's font slug. A face that is not bundled gets
 * the generic family: `themeIssues` rejects such a theme before it is applied (UI-031).
 */
export function fontStack(slug: string): string {
  const face = bundledFaces.get(slug);
  return face === undefined ? 'sans-serif' : `'${face.cssFamily}', ${face.fallback}`;
}

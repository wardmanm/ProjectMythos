import { z } from 'zod';
import { ContentSchemaVersionSchema, SlugSchema, ThemeIdSchema } from './common';

/*
 * A theme is a campaign's look (14-ui §3): colors, type, and a few ornaments. Themes
 * change tokens only; layout and components are the same in every theme.
 */

const HexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Every color a theme must define. Contrast rules are checked by `themeIssues` (UI-031). */
export const PaletteSchema = z.strictObject({
  background: HexSchema, // the page
  surface: HexSchema, // panels, cards, the input dock
  text: HexSchema, // narration and primary text
  textMuted: HexSchema, // secondary text: timestamps, roll lines, hints
  playerText: HexSchema, // the player's own input in the story
  accent: HexSchema, // primary actions, focus rings, links
  onAccent: HexSchema, // text on accent-colored buttons
  border: HexSchema, // dividers and outlines
  positive: HexSchema, // success, healing
  caution: HexSchema, // partial results, stale stages, GM mode frame
  negative: HexSchema, // failure, harm, errors
});
export type Palette = z.infer<typeof PaletteSchema>;

/** A bundled font (UI-034) or a font file shipped in the pack's `fonts/` folder. */
export const FontRefSchema = z.strictObject({
  family: SlugSchema, // e.g. "spectral"; resolved against the font registry
  weight: z.int().min(100).max(900).default(400),
  italicForEmphasis: z.boolean().default(true),
});

export const ThemeSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: ThemeIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  /** At least one. With both, the device's light/dark preference picks (UI-033). */
  palettes: z.strictObject({ dark: PaletteSchema.optional(), light: PaletteSchema.optional() }),
  fonts: z.strictObject({
    narration: FontRefSchema, // the story
    interface: FontRefSchema, // controls, panels, labels
    display: FontRefSchema.optional(), // scene and place headings; defaults to narration
    mechanics: FontRefSchema.optional(), // dice cards and numbers; defaults to interface
  }),
  narration: z.strictObject({
    size: z.enum(['small', 'medium', 'large']).default('medium'), // 17, 19, 21 px base
    lineHeight: z.number().min(1.3).max(2).default(1.6),
    measure: z.int().min(45).max(80).default(66), // characters per line, at most
  }),
  shape: z.strictObject({ radius: z.int().min(0).max(16).default(6) }),
  ornament: z.strictObject({
    sceneBreak: z.string().max(12).default('*'), // shown between scenes
    dropCap: z.boolean().default(false), // first letter of each scene's opening narration
    texture: z.enum(['none', 'grain', 'paper', 'scanlines']).default('none'), // CSS-generated, no images
  }),
});
export type Theme = z.infer<typeof ThemeSchema>;

/** Bundled fonts: SIL Open Font License faces shipped with the app (UI-034). */
export const BUNDLED_FONTS = [
  'atkinson-hyperlegible',
  'spectral',
  'alegreya-sans',
  'gentium-book-plus',
  'figtree',
  'ibm-plex-sans',
  'ibm-plex-mono',
  'crimson-pro',
  'im-fell-english',
  'literata',
] as const;

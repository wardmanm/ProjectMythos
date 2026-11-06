// The narrator's view model (CTX-006): the typed data `narrator.md` and its partials read.
// narrator.ts builds it; templates never compute.
import type { ContentSettings, IntensityLevel } from '@mythos/contracts/content';
import {
  CATEGORY_LABELS,
  CONTENT_CATEGORIES,
  type ContentCategory,
  DEFAULT_WORDING,
} from '@mythos/core';

/** One content category: the default wording, and a flag per level for rewording (CSET-011). */
export type ContentCategoryView = {
  category: ContentCategory;
  /** "Violence". Not `label`, which would call the label helper (09-context Traps). */
  name: string;
  level: IntensityLevel;
  instruction: string;
  off: boolean;
  fadeToBlack: boolean;
  moderate: boolean;
  explicit: boolean;
};

/** What the `content-settings` partial reads (CSET-010). */
export type ContentView = { categories: ContentCategoryView[]; lines: string[]; veils: string[] };

/** A character's public block (CTX §6.1): what anyone present sees. */
export type CharacterView = {
  /** The name the PC knows them by (JRN-020, CTX-052). */
  name: string;
  pc: boolean;
  /** Built by core (GEAR-060); one sentence once trimmed. */
  appearance: string;
  /** Null once trimmed, or when they have none. */
  personality: string | null;
};

/**
 * Everything `narrator.md` and its partials read. Every key is always present, with null
 * for nothing, because strict mode does not check a name inside `#if` (09-context Traps).
 */
export type NarratorView = {
  narration: {
    secondPerson: boolean;
    thirdPerson: boolean;
    presentTense: boolean;
    pastTense: boolean;
    brief: boolean;
    standardLength: boolean;
    rich: boolean;
    style: string;
  };
  tone: {
    genre: string;
    tone: string;
    themes: string[];
    slowPacing: boolean;
    standardPacing: boolean;
    fastPacing: boolean;
  };
  content: ContentView;
  setting: { name: string; summary: string };
  pc: {
    name: string;
    personality: string;
    statMin: number;
    statMax: number;
    stats: { name: string; rating: number }[];
  };
  scene: {
    place: { name: string; description: string };
    date: string;
    timeOfDay: string;
    characters: CharacterView[];
  };
  transcript: { turns: { input: string | null; narration: string }[] };
  /** The opening file at turn zero (CTX-076), else the player's input. */
  turn: { opening: string | null; input: string | null };
  task: { opening: boolean };
};

/**
 * The content-settings partial's view: each category in order with its level's default
 * wording from core, so the wording has one home, then lines and veils verbatim.
 * Implements CSET-010 and CSET-011.
 */
export function contentView(settings: ContentSettings): ContentView {
  return {
    categories: CONTENT_CATEGORIES.map((category) => {
      const level = settings[category];
      return {
        category,
        name: CATEGORY_LABELS[category],
        level,
        instruction: DEFAULT_WORDING[category][level],
        off: level === 'off',
        fadeToBlack: level === 'fade-to-black',
        moderate: level === 'moderate',
        explicit: level === 'explicit',
      };
    }),
    lines: [...settings.lines],
    veils: [...settings.veils],
  };
}

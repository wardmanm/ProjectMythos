// The narrator's phase-1 recipe (09-context §7, §11): instructions, world, scene,
// transcript, turn, and task, with the view model built in code so templates only read
// (CTX-006).
import type { Character, Entity, Item, Tier } from '@mythos/contracts';
import type { ContentSettings } from '@mythos/contracts/content';
import {
  appearanceOf,
  cmp,
  displayName,
  effectiveSettings,
  formatDate,
  minorInvolved,
  toDate,
} from '@mythos/core';
import type { FitChoice } from './budget';
import { type CharacterView, contentView, type NarratorView } from './narrator-view';
import type { CampaignAtPoint } from './read';

/** The narrator's tiers in phase 1, in order: no state or knowledge yet (09-context §11). */
export const NARRATOR_TIERS: readonly Tier[] = [
  'instructions',
  'world',
  'scene',
  'transcript',
  'turn',
  'task',
];

/** The narrator's default weights for its phase-1 trimmable tiers (CTX-033). */
export const NARRATOR_WEIGHTS = { scene: 15, transcript: 45 };

function isCharacter(entity: Entity): entity is Character {
  return entity.kind === 'pc' || entity.kind === 'npc';
}

/** A name without a leading article, for matching what the player typed. */
function bareName(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, '');
}

/** The first sentence of an appearance, which is what a trim keeps (CTX-034). */
function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/s.exec(text);
  return match === null ? text : match[0];
}

/** One step of trimming the scene, applied in order (CTX-034). */
type SceneTrim = { label: string; characterId: string; part: 'personality' | 'appearance' };

/** A narrator prompt's inputs: the view for each choice `fitPrompt` makes. */
export type NarratorRecipe = {
  /** A minor is present or involved, so the prompt is tightened (CSET-042). */
  minor: boolean;
  trims: SceneTrim[];
  transcriptTurns: number;
  view(choice: FitChoice): NarratorView;
};

/**
 * Who is in the scene: alive characters at the scene's place. In phase 1 they all joined
 * when it started, so they are listed by ID (CTX-012).
 */
function presentCharacters(at: CampaignAtPoint): Character[] {
  const { world } = at.state;
  return Object.values(world.entities)
    .filter(isCharacter)
    .filter((each) => each.lifeState === 'alive' && each.locationId === world.scenePlaceId)
    .sort((a, b) => cmp(a.id, b.id));
}

/**
 * Who is involved this turn: the PC, and anyone the input names by the name the PC knows
 * them by, present or not. Phase 1 has no ruling to name targets (CTX-060).
 */
function involvedIds(at: CampaignAtPoint, nameOf: (entity: Entity) => string): Set<string> {
  const involved = new Set([at.pcId]);
  if (at.turn.opening) return involved;
  const input = at.turn.input.toLowerCase();
  for (const entity of Object.values(at.state.world.entities).filter(isCharacter)) {
    const name = nameOf(entity).toLowerCase();
    if (input.includes(name) || input.includes(bareName(name))) involved.add(entity.id);
  }
  return involved;
}

type PublicBlock = { id: string; view: CharacterView; shortAppearance: string };

/** Each present character's public block, untrimmed, and the appearance a trim keeps. */
function publicBlocks(
  at: CampaignAtPoint,
  present: readonly Character[],
  nameOf: (entity: Entity) => string,
): PublicBlock[] {
  const items = Object.values(at.state.world.entities).filter(
    (each): each is Item => each.kind === 'item',
  );
  return present.map((character) => {
    // Only what others can see: concealed items stay out (CTX-071).
    const appearance = appearanceOf(character, items, at.slots, at.ruleset).text;
    const personality = character.personality === '' ? null : character.personality;
    const view = { name: nameOf(character), pc: character.id === at.pcId, appearance, personality };
    return { id: character.id, view, shortAppearance: firstSentence(appearance) };
  });
}

function sceneTrims(blocks: readonly PublicBlock[], involved: ReadonlySet<string>): SceneTrim[] {
  const uninvolved = blocks.filter(({ id }) => !involved.has(id));
  return [
    ...uninvolved
      .filter(({ view }) => view.personality !== null)
      .map(({ id }) => ({
        label: `personality of ${id}`,
        characterId: id,
        part: 'personality' as const,
      })),
    ...uninvolved
      .filter(({ view, shortAppearance }) => shortAppearance !== view.appearance)
      .map(({ id }) => ({
        label: `appearance of ${id}`,
        characterId: id,
        part: 'appearance' as const,
      })),
  ];
}

/** The parts of the view that never change with trimming. */
function fixedView(
  at: CampaignAtPoint,
  settings: ContentSettings,
  nameOf: (entity: Entity) => string,
) {
  const { tone, ruleset, state } = at;
  const pc = state.world.entities[at.pcId];
  const place = state.world.entities[state.world.scenePlaceId];
  if (pc === undefined || !isCharacter(pc) || place?.kind !== 'place') {
    throw new Error('the folded state has no PC or no scene place');
  }
  const date = toDate(at.calendar, at.setting.epoch, at.setting.epochWeekday, state.world.gameTime);
  return {
    narration: {
      secondPerson: tone.narration.perspective === 'second-person',
      thirdPerson: tone.narration.perspective === 'third-person',
      presentTense: tone.narration.tense === 'present',
      pastTense: tone.narration.tense === 'past',
      brief: tone.narration.length === 'brief',
      standardLength: tone.narration.length === 'standard',
      rich: tone.narration.length === 'rich',
      style: tone.narration.style,
    },
    tone: {
      genre: tone.genre,
      tone: tone.tone,
      themes: [...tone.themes],
      slowPacing: tone.pacing === 'slow',
      standardPacing: tone.pacing === 'standard',
      fastPacing: tone.pacing === 'fast',
    },
    content: contentView(settings),
    setting: { name: at.setting.name, summary: at.setting.summary },
    pc: {
      name: nameOf(pc),
      personality: pc.personality,
      statMin: ruleset.stats.min,
      statMax: ruleset.stats.max,
      stats: ruleset.stats.list.map((stat) => ({
        name: stat.name,
        rating: pc.stats[stat.id] ?? ruleset.stats.default,
      })),
    },
    place: { name: nameOf(place), description: place.description },
    date: formatDate(at.calendar, date),
    timeOfDay: date.timeOfDay,
  };
}

/**
 * The narrator's recipe at a point: display names for the PC (JRN-020, CTX-052),
 * appearance from core (GEAR-060), settings tightened while a minor is present or
 * involved (CSET-042), the scene's trims, and the current scene's earlier turns.
 * Implements CTX-006, CTX-012, CTX-071, CTX-076, and CTX-081.
 */
export function narratorRecipe(at: CampaignAtPoint): NarratorRecipe {
  const { state } = at;
  const learned = Object.entries(state.names[at.pcId] ?? {}).map(([entityId, name]) => ({
    entityId,
    name,
  }));
  const nameOf = (entity: Entity) => displayName(entity, at.pcId, learned);
  const present = presentCharacters(at);
  const involved = involvedIds(at, nameOf);
  const minor = minorInvolved(state.world.entities, [...present.map(({ id }) => id), ...involved]);
  const fixed = fixedView(at, effectiveSettings(at.contentSettings, minor), nameOf);
  const blocks = publicBlocks(at, present, nameOf);
  const trims = sceneTrims(blocks, involved);

  return {
    minor,
    trims,
    transcriptTurns: at.sceneTurns.length,
    view(choice) {
      const applied = trims.slice(0, choice.sceneTrims);
      const trimmed = (id: string, part: SceneTrim['part']) =>
        applied.some((trim) => trim.characterId === id && trim.part === part);
      const characters = blocks.map(({ id, view, shortAppearance }) => ({
        ...view,
        appearance: trimmed(id, 'appearance') ? shortAppearance : view.appearance,
        personality: trimmed(id, 'personality') ? null : view.personality,
      }));
      const { from, to } = choice.transcript;
      return {
        narration: fixed.narration,
        tone: fixed.tone,
        content: fixed.content,
        setting: fixed.setting,
        pc: fixed.pc,
        scene: { place: fixed.place, date: fixed.date, timeOfDay: fixed.timeOfDay, characters },
        transcript: { turns: at.sceneTurns.slice(from, to).map((turn) => ({ ...turn })) },
        turn: at.turn.opening
          ? { opening: at.opening, input: null }
          : { opening: null, input: at.turn.input },
        task: { opening: at.turn.opening },
      };
    },
  };
}

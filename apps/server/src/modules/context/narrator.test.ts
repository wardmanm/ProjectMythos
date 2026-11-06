import { type Entity, ModelProfileSchema } from '@mythos/contracts';
import type { ContentSettings, IntensityLevel } from '@mythos/contracts/content';
import { CONTENT_CATEGORIES, HARD_FLOOR, renderContentSettings } from '@mythos/core';
import { describe, expect, it } from 'vitest';
import { narratorPrompt } from './builder';
import { narratorRecipe } from './narrator';
import { contentView, type NarratorView } from './narrator-view';
import type { CampaignAtPoint } from './read';
import { prepareTemplate } from './templates';
import { engineTemplates, type MemoryLayers, memoryLookup, referenceAtTurnZero } from './testing';

const profile = ModelProfileSchema.parse({
  id: 'local',
  providerId: 'mock',
  model: 'mock-model',
  kind: 'text',
  contextWindow: 32768,
  maxOutputTokens: 2048,
  structuredOutput: 'json-schema',
});

const everything = { from: 0, to: 0 };
const untrimmed = (at: CampaignAtPoint): NarratorView =>
  narratorRecipe(at).view({
    sceneTrims: 0,
    transcript: { ...everything, to: at.sceneTurns.length },
  });

/** The whole prompt's text, messages joined, built with the engine's templates and `layers`. */
async function promptText(at: CampaignAtPoint, layers: MemoryLayers = {}): Promise<string> {
  const lookup = memoryLookup({ ...layers, engine: engineTemplates() });
  const built = await narratorPrompt(at, { lookup, profile, charsPerToken: 3.5, chunkTurns: 8 });
  if (!built.ok) throw new Error(built.error.message);
  return built.value.prompt.messages.map((message) => message.content).join('\n\n');
}

/** `at` with the player's input for a turn after turn zero. */
function withInput(at: CampaignAtPoint, input: string): CampaignAtPoint {
  return {
    ...at,
    turn: { opening: false, input },
    sceneTurns: [{ input: null, narration: 'Rain on the coach roof. The taproom goes quiet.' }],
  };
}

/** `at` with one entity changed. */
function withEntity(
  at: CampaignAtPoint,
  id: string,
  change: (entity: Entity) => Entity,
): CampaignAtPoint {
  const entity = at.state.world.entities[id];
  if (entity === undefined) throw new Error(`no ${id}`);
  const entities = { ...at.state.world.entities, [id]: change(entity) };
  return { ...at, state: { ...at.state, world: { ...at.state.world, entities } } };
}

/** `at` with Pip, a minor, in the taproom. */
const withPipPresent = (at: CampaignAtPoint) =>
  withEntity(at, 'npc.pip', (pip) =>
    pip.kind === 'npc' ? { ...pip, locationId: at.state.world.scenePlaceId } : pip,
  );

/** Every path in `value` that holds `undefined`. */
function undefinedPaths(value: unknown, at = ''): string[] {
  if (value === undefined) return [at];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => undefinedPaths(child, `${at}.${key}`));
}

describe('the view model', () => {
  it('CTX-006: is built in code, with every key present and null for nothing', async () => {
    const at = await referenceAtTurnZero();
    const view = untrimmed(at);
    expect(undefinedPaths(view)).toEqual([]);
    expect(view.pc).toMatchObject({ name: 'Wren Ashby', statMin: 1, statMax: 5 });
    expect(view.pc.stats).toEqual([
      { name: 'Strength', rating: 2 },
      { name: 'Endurance', rating: 3 },
      { name: 'Dexterity', rating: 3 },
      { name: 'Intelligence', rating: 4 },
      { name: 'Charisma', rating: 3 },
    ]);
    expect(view.turn).toEqual({ opening: at.opening, input: null });
    expect(view.task).toEqual({ opening: true });
    expect(view.transcript).toEqual({ turns: [] });
  });

  it('CTX-012: characters are listed by ID, with dates in the calendar’s fixed format', async () => {
    const at = await referenceAtTurnZero();
    const view = untrimmed(withPipPresent(at));
    expect(view.scene.characters.map(({ name }) => name)).toEqual([
      'the innkeeper',
      'the errand girl',
      'Wren Ashby',
    ]);
    expect(view.scene.date).toBe('Monday, October 12, 1874 (evening)');
    expect(view.scene.timeOfDay).toBe('evening');
  });

  it('CTX-012: the same inputs give the same bytes, whatever order the entities were folded in', async () => {
    const at = await referenceAtTurnZero();
    const reversed = Object.fromEntries(Object.entries(at.state.world.entities).reverse());
    const shuffled = {
      ...at,
      state: { ...at.state, world: { ...at.state.world, entities: reversed } },
    };
    expect(await promptText(shuffled)).toBe(await promptText(at));
  });

  it('CTX-052: names are the ones the PC knows: Odette is the innkeeper until Wren learns her name', async () => {
    const at = await referenceAtTurnZero();
    const before = await promptText(at);
    expect(before).toContain('- the innkeeper: Broad and quick-moving');
    expect(before).not.toContain('Odette');
    const names = {
      ...at.state.names,
      'pc.wren': { ...at.state.names['pc.wren'], 'npc.odette': 'Odette' },
    };
    const after = await promptText({ ...at, state: { ...at.state, names } });
    expect(after).toContain('- Odette: Broad and quick-moving');
    expect(after).not.toContain('Odette Marsh');
    expect(after).toContain('Never use a name Wren Ashby has not learned.');
  });

  it('CTX-071: the narrator never sees concealed items, canon Markdown, or GM clocks', async () => {
    const at = await referenceAtTurnZero();
    const clock = {
      id: 'clock.wardens-suspicion',
      name: 'The Wardens grow suspicious',
      segments: 6,
      filled: 2,
      visibility: 'gm' as const,
      kind: 'progress' as const,
    };
    const world = { ...at.state.world, clocks: { [clock.id]: clock } };
    const text = await promptText({ ...at, state: { ...at.state, world } });
    expect(text).toContain('Wearing: oilskin cloak, wool trousers, boots. Holding: carpetbag.');
    for (const hidden of [
      'fishing knife',
      'silver locket',
      'linen shirt',
      'spare clothes',
      'coins',
    ]) {
      expect(text).not.toContain(hidden);
    }
    // Odette's canon, truth and common knowledge alike.
    expect(text).not.toContain('Bram');
    expect(text).not.toContain('fish stew is the best');
    expect(text).not.toContain('Wardens grow suspicious');
  });

  it('CTX-081: the tone, narration-style, and content-settings partials render the tone profile', async () => {
    const text = await promptText(await referenceAtTurnZero());
    expect(text).toContain(
      '## Narration style\n\n- Second person: the player\'s character is "you".\n- Present tense.\n' +
        '- Two or three paragraphs.\n- Concrete sensory detail over adjectives.',
    );
    expect(text).toContain(
      '## Tone\n\n- Genre: low-fantasy mystery.\n- Mood: Melancholy, atmospheric, grounded.',
    );
    expect(text).toContain(
      '- Themes: secrets, loyalty, the sea as indifferent, outsiders.\n- Pacing: slow.',
    );
    expect(text).toContain('- Violence: Violence is shown plainly and with consequence');
    expect(text).toContain(
      'These may happen in the story but only off-page, never described: harm to animals.',
    );
  });
});

describe('content settings', () => {
  const levels: readonly IntensityLevel[] = ['off', 'fade-to-black', 'moderate', 'explicit'];

  async function renderedPartial(settings: ContentSettings, layers: MemoryLayers = {}) {
    const engine = engineTemplates();
    const lookup = memoryLookup({
      ...layers,
      engine: { ...engine, 'narrator.md': '{{> content-settings content}}' },
    });
    const prepared = await prepareTemplate(
      lookup,
      'narrator.md',
      (await referenceAtTurnZero()).ruleset,
    );
    if (!prepared.ok) throw new Error(prepared.error.message);
    const rendered = prepared.value.render({ content: contentView(settings) });
    if (!rendered.ok) throw new Error(rendered.error.message);
    return rendered.value;
  }

  it('CSET-010: every category at every level renders the default wording, then lines and veils verbatim', async () => {
    for (const level of levels) {
      for (const [lines, veils] of [
        [[], []],
        [['spiders'], []],
        [[], ['torture', 'harm to animals']],
        [['drowning', 'spiders'], ['gore']],
      ]) {
        const settings: ContentSettings = {
          ...Object.fromEntries(CONTENT_CATEGORIES.map((category) => [category, level])),
          lines,
          veils,
        } as ContentSettings;
        expect(await renderedPartial(settings)).toBe(`${renderContentSettings(settings)}\n`);
      }
    }
  });

  it('CSET-011: any layer may reword the partial, using each level’s flag', async () => {
    const settings = (await referenceAtTurnZero()).contentSettings;
    const reworded =
      '{{#each categories}}{{name}}: {{#if off}}never{{/if}}{{#if fadeToBlack}}off-page{{/if}}' +
      '{{#if moderate}}shown{{/if}}{{#if explicit}}anything{{/if}}\n{{/each}}';
    const text = await renderedPartial(settings, {
      campaign: { 'partials/content-settings.md': reworded },
    });
    expect(text).toBe(
      'Violence: shown\nGore: off-page\nSexual: off-page\nLanguage: shown\nDisturbing: shown\n',
    );
  });

  it('CSET-042: with a minor present, sexual renders off and the floor ends the task tier', async () => {
    const at = withPipPresent(await referenceAtTurnZero());
    expect(narratorRecipe(at).minor).toBe(true);
    const text = await promptText(at);
    expect(text).toContain('- Sexual: No sexual content.');
    expect(text.endsWith(HARD_FLOOR)).toBe(true);
    expect(text.split(HARD_FLOOR)).toHaveLength(3);
  });

  it('CSET-042: a minor the input names is involved too, even when elsewhere', async () => {
    const at = withInput(
      await referenceAtTurnZero(),
      'I ask about the errand girl down at the harbor.',
    );
    expect(narratorRecipe(at).minor).toBe(true);
    expect((await promptText(at)).endsWith(HARD_FLOOR)).toBe(true);
  });

  it('CSET-042: with only adults present, the settings are the campaign’s and the floor appears once', async () => {
    const at = await referenceAtTurnZero();
    expect(narratorRecipe(at).minor).toBe(false);
    const text = await promptText(at);
    expect(text).toContain('- Sexual: Intimacy may happen but always off-page');
    expect(text.split(HARD_FLOOR)).toHaveLength(2);
  });
});

describe('scene trims', () => {
  /** Pip in the taproom, holding Wren's carpetbag, so her appearance has two sentences. */
  async function pipWithBag(): Promise<CampaignAtPoint> {
    const at = withPipPresent(await referenceAtTurnZero());
    return withEntity(at, 'item.carpetbag', (bag) =>
      bag.kind === 'item' ? { ...bag, location: { type: 'held', characterId: 'npc.pip' } } : bag,
    );
  }

  it('CTX-034: only characters not involved this turn are trimmed: personality, then appearance', async () => {
    const at = await pipWithBag();
    expect(narratorRecipe(at).trims.map(({ label }) => label)).toEqual([
      'personality of npc.odette',
      'personality of npc.pip',
      'appearance of npc.pip',
    ]);
    const named = withInput(at, 'I wave to the innkeeper.');
    expect(narratorRecipe(named).trims.map(({ label }) => label)).toEqual([
      'personality of npc.pip',
      'appearance of npc.pip',
    ]);
  });

  it('CTX-034: a trimmed appearance keeps its first sentence, and a trimmed personality is gone', async () => {
    const recipe = narratorRecipe(await pipWithBag());
    const full = recipe.view({ sceneTrims: 0, transcript: everything }).scene.characters[1];
    expect(full?.appearance).toBe(
      'Small and wiry, in a patched coat two sizes too big, with a cap pulled low over tangled hair. Holding: carpetbag.',
    );
    expect(recipe.view({ sceneTrims: 3, transcript: everything }).scene.characters[1]).toEqual({
      name: 'the errand girl',
      pc: false,
      appearance:
        'Small and wiry, in a patched coat two sizes too big, with a cap pulled low over tangled hair.',
      personality: null,
    });
  });
});

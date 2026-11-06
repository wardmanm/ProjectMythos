import type { AppError, Result } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareTemplate, type TemplateLookup } from './templates';
import { createFolders, memoryLookup, standardRuleset } from './testing';

const folders = createFolders();
afterEach(() => {
  folders.cleanUp();
});

const ruleset = standardRuleset();

/** Prepares and renders `file`, returning the text or the error. */
async function rendered(
  lookup: TemplateLookup,
  view: object = {},
  file = 'narrator.md',
): Promise<Result<string, AppError>> {
  const prepared = await prepareTemplate(lookup, file, ruleset);
  return prepared.ok ? prepared.value.render(view) : prepared;
}

async function text(lookup: TemplateLookup, view: object = {}): Promise<string> {
  const result = await rendered(lookup, view);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function failure(lookup: TemplateLookup, view: object = {}): Promise<AppError> {
  const result = await rendered(lookup, view);
  if (result.ok) throw new Error(`rendered: ${result.value}`);
  return result.error;
}

describe('rendering', () => {
  it('CTX-001: a missing variable fails rendering, naming the file and its layer', async () => {
    const error = await failure(memoryLookup({ pack: { 'narrator.md': 'Hello {{pc.name}}.' } }), {
      pc: {},
    });
    expect(error.code).toBe('validation_failed');
    expect(error.message).toBe(
      'Template narrator.md (pack layer) cannot be rendered: "name" not defined (line 1, column 9)',
    );
    expect(error.details).toEqual({ layer: 'pack', path: 'narrator.md' });
  });

  it('CTX-001: prompts are not HTML, so nothing is escaped', async () => {
    const lookup = memoryLookup({ engine: { 'narrator.md': '{{a}} & {{{a}}}' } });
    expect(await text(lookup, { a: '<b>"Fish & chips"</b>' })).toBe(
      '<b>"Fish & chips"</b> & <b>"Fish & chips"</b>',
    );
  });

  it('CTX-106: an engine template that fails throws, because the shipped templates are broken', async () => {
    const lookup = memoryLookup({ engine: { 'narrator.md': '{{missing}}' } });
    await expect(rendered(lookup)).rejects.toThrow(
      'Template narrator.md (engine layer) cannot be rendered: "missing" not defined',
    );
  });

  it('CTX-106: an override that breaks an engine partial is still the override’s failure', async () => {
    const lookup = memoryLookup({
      campaign: { 'narrator.md': '{{> tone}}' },
      engine: { 'partials/tone.md': '{{genre}}\n' },
    });
    const error = await failure(lookup, { tone: { genre: 'mystery' } });
    expect(error.code).toBe('validation_failed');
    expect(error.details).toEqual({ layer: 'engine', path: 'partials/tone.md' });
  });

  it('CTX-001: a syntax error in an override fails with its file and layer', async () => {
    const error = await failure(memoryLookup({ campaign: { 'narrator.md': '{{#if a}}open' } }));
    expect(error.code).toBe('validation_failed');
    expect(error.message).toMatch(/^Template narrator\.md \(campaign layer\) cannot be rendered:/);
  });

  it('CTX-004: no layer has the file', async () => {
    const result = await prepareTemplate(memoryLookup({}), 'narrator.md', ruleset);
    expect(result).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'No layer has template narrator.md.' },
    });
  });
});

describe('helpers', () => {
  it('CTX-002: join joins a list with a separator', async () => {
    const lookup = memoryLookup({ engine: { 'narrator.md': '{{join themes ", "}}' } });
    expect(await text(lookup, { themes: ['secrets', 'loyalty'] })).toBe('secrets, loyalty');
  });

  it('CTX-002: join refuses anything but a list', async () => {
    const lookup = memoryLookup({ pack: { 'narrator.md': '{{join themes ", "}}' } });
    expect((await failure(lookup, { themes: 'secrets' })).message).toContain(
      'join takes a list of strings and a separator',
    );
  });

  it('CTX-002: label gives the ruleset’s result, effect, and harm labels by key', async () => {
    const template =
      '{{label "result.partial"}}; {{label "effect.great"}}; {{label "harm.1"}}; {{label "harm.4"}}';
    const lookup = memoryLookup({ engine: { 'narrator.md': template } });
    expect(await text(lookup)).toBe('Partial; Great; Lesser; Fatal');
  });

  it('CTX-002: an unknown label key fails rendering', async () => {
    const lookup = memoryLookup({ pack: { 'narrator.md': '{{label "result.meh"}}' } });
    const error = await failure(lookup);
    expect(error.message).toContain('label takes one of these keys: effect.great, effect.limited');
    expect(error.message).toContain('got "result.meh"');
  });

  it.each([
    ['an unknown helper', '{{shout name}}'],
    ['lookup', '{{lookup list 1}}'],
    ['log', '{{log name}}'],
  ])('CTX-002: %s is not a helper', async (_, template) => {
    const lookup = memoryLookup({ campaign: { 'narrator.md': template } });
    const error = await failure(lookup, { name: 'Wren', list: [1, 2] });
    expect(error.message).toContain('knownHelpersOnly');
  });

  it('CTX-002: if, unless, each, and with work', async () => {
    const template =
      '{{#if a}}A{{/if}}{{#unless b}}B{{/unless}}{{#each list}}[{{this}}]{{/each}}{{#with pc}}{{name}}{{/with}}';
    const lookup = memoryLookup({ engine: { 'narrator.md': template } });
    expect(await text(lookup, { a: true, b: false, list: [1, 2], pc: { name: 'Wren' } })).toBe(
      'AB[1][2]Wren',
    );
  });

  it.each([
    ['an inline partial', '{{#*inline "x"}}y{{/inline}}{{> x}}'],
    ['a partial block', '{{#> tone}}fallback{{/tone}}'],
    ['a dynamic partial', '{{> (name) }}'],
  ])('CTX-002: %s is not allowed', async (_, template) => {
    const lookup = memoryLookup({ pack: { 'narrator.md': template } });
    const error = await failure(lookup, { name: 'tone' });
    expect(error.code).toBe('validation_failed');
  });
});

describe('partials', () => {
  it('CTX-003: {{> tone}} is partials/tone.md, and a layer replaces one partial without copying the rest', async () => {
    const lookup = memoryLookup({
      pack: { 'partials/tone.md': 'Pack tone.\n' },
      engine: {
        'narrator.md': '{{> narration-style}}{{> tone}}',
        'partials/narration-style.md': 'Engine style.\n',
        'partials/tone.md': 'Engine tone.\n',
      },
    });
    const prepared = await prepareTemplate(lookup, 'narrator.md', ruleset);
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(prepared.value.render({})).toEqual({ ok: true, value: 'Engine style.\nPack tone.\n' });
    expect(prepared.value.used).toEqual([
      'engine:narrator.md',
      'engine:partials/narration-style.md',
      'pack:partials/tone.md',
    ]);
  });

  it('CTX-003: a partial gets the context it is given, and may use partials of its own', async () => {
    const lookup = memoryLookup({
      engine: {
        'narrator.md': '{{#each characters}}{{> character-public}}{{/each}}',
        'partials/character-public.md': '- {{name}}{{> mark}}\n',
        'partials/mark.md': '!',
      },
    });
    expect(await text(lookup, { characters: [{ name: 'Wren' }, { name: 'the innkeeper' }] })).toBe(
      '- Wren!\n- the innkeeper!\n',
    );
  });

  it('CTX-003: a partial no layer has fails, naming the file that uses it', async () => {
    const lookup = memoryLookup({ campaign: { 'narrator.md': '{{> missing}}' } });
    const error = await failure(lookup);
    expect(error.message).toBe(
      'Template narrator.md (campaign layer) cannot be rendered: {{> missing}} names partials/missing.md, which no layer has',
    );
  });

  it('CTX-003: a partial that includes itself fails', async () => {
    const lookup = memoryLookup({
      campaign: { 'partials/b.md': '{{> a}}' },
      engine: { 'narrator.md': '{{> a}}', 'partials/a.md': '{{> b}}' },
    });
    expect((await failure(lookup)).message).toContain('{{> a}} includes itself');
  });
});

describe('layers', () => {
  const name = (layer: string) => ({ 'partials/tone.md': `${layer}\n` });

  it('CTX-004, CTX-106: a name resolves to the highest-priority layer that has it', async () => {
    const profileDir = folders.withFiles(name('model-profile'));
    const all = {
      campaign: name('campaign'),
      profileDir,
      'tone-profile': name('tone-profile'),
      pack: name('pack'),
      ruleset: name('ruleset'),
      engine: { ...name('engine'), 'narrator.md': '{{> tone}}' },
    };
    const order = ['campaign', 'profileDir', 'tone-profile', 'pack', 'ruleset', 'engine'] as const;
    const winners: string[] = [];
    for (const [index] of order.entries()) {
      // Take away every layer above this one.
      const layers = Object.fromEntries(
        Object.entries(all).filter(
          ([key]) => !order.slice(0, index).some((above) => above === key),
        ),
      );
      winners.push((await text(memoryLookup(layers))).trim());
    }
    expect(winners).toEqual([
      'campaign',
      'model-profile',
      'tone-profile',
      'pack',
      'ruleset',
      'engine',
    ]);
  });

  it('SCH-023: the tone profile’s templates are layer 3 and the ruleset’s layer 5', async () => {
    const lookup = memoryLookup({
      'tone-profile': { 'partials/narration-style.md': 'Grim.\n' },
      ruleset: { 'partials/tone.md': 'Rules tone.\n' },
      pack: { 'partials/narration-style.md': 'Pack style.\n' },
      engine: {
        'narrator.md': '{{> narration-style}}{{> tone}}',
        'partials/narration-style.md': 'Engine style.\n',
        'partials/tone.md': 'Engine tone.\n',
      },
    });
    const prepared = await prepareTemplate(lookup, 'narrator.md', ruleset);
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(prepared.value.render({})).toEqual({ ok: true, value: 'Grim.\nRules tone.\n' });
    expect(prepared.value.used).toEqual([
      'engine:narrator.md',
      'ruleset:partials/tone.md',
      'tone-profile:partials/narration-style.md',
    ]);
  });

  it('CTX-004: a model profile’s files are read as LF text without a BOM', async () => {
    const profileDir = folders.withFiles({ 'narrator.md': '﻿Blunt.\r\nShort.\r\n' });
    expect(await text(memoryLookup({ profileDir }))).toBe('Blunt.\nShort.\n');
  });
});

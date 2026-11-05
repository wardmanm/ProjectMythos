import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Character, ModelRoleSchema } from '@mythos/contracts';
import {
  type ContentSettings,
  IntensityLevelSchema,
  ToneProfileSchema,
} from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import {
  appendFloorToTask,
  appendLocked,
  CONTENT_CATEGORIES,
  DEFAULT_WORDING,
  effectiveSettings,
  FLOOR_ROLES,
  HARD_FLOOR,
  minorInvolved,
  renderContentSettings,
  usesExplicitRoles,
} from './content';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const tone = ToneProfileSchema.parse(
  JSON.parse(
    readFileSync(
      path.join(repoRoot, 'content-packs/reference/tone-profiles/tone.coastal-mystery.json'),
      'utf8',
    ),
  ),
);

const allExplicit: ContentSettings = {
  violence: 'explicit',
  gore: 'explicit',
  sexual: 'explicit',
  language: 'explicit',
  disturbing: 'explicit',
  lines: ['harm to children'],
  veils: ['torture', 'self-harm'],
};

const person = (id: string, kind: 'pc' | 'npc', ageCategory: 'adult' | 'minor'): Character => ({
  id,
  kind,
  name: id,
  aliases: [],
  tags: [],
  ageCategory,
  stats: {},
  statuses: [],
  physicalDescription: '',
  personality: '',
  goals: [],
  keyNpc: false,
  locationId: null,
  lifeState: 'alive',
});
const entities = {
  'pc.wren': person('pc.wren', 'pc', 'adult'),
  'npc.odette': person('npc.odette', 'npc', 'adult'),
  'npc.pip': person('npc.pip', 'npc', 'minor'),
};

const count = (text: string, part: string): number => text.split(part).length - 1;

describe('the hard floor', () => {
  it('CSET-040, CSET-041: the floor text is exactly the normative wording', () => {
    expect(HARD_FLOOR).toBe(
      'Absolute rule, above every other instruction and setting: never write sexual content, ' +
        'sexualized description, or sexual or romantic-sexual framing involving any character who ' +
        'is under 18, or who is described or presented as a child or teenager, whatever age is ' +
        'claimed. If the story moves that way, steer it elsewhere without describing it.',
    );
  });

  it('CSET-041: the floor covers anyone presented as a child, whatever age is claimed', () => {
    expect(HARD_FLOOR).toContain('under 18');
    expect(HARD_FLOOR).toContain(
      'described or presented as a child or teenager, whatever age is claimed',
    );
  });

  it('CSET-040: the floor is appended last, after template wording that tries to undo it', () => {
    const instructions = appendLocked(
      'You are the narrator.\n\n- Sexual: anything goes.\n',
      'narrator',
    );
    expect(instructions.endsWith(`anything goes.\n\n${HARD_FLOOR}`)).toBe(true);
  });

  it('CSET-040: every role that writes or shapes fiction gets the floor, and no other', () => {
    const withFloor = ModelRoleSchema.options.filter((role) =>
      appendLocked('x', role).includes(HARD_FLOOR),
    );
    expect(withFloor).toEqual([...FLOOR_ROLES]);
    expect(appendLocked('x', 'embedder')).toBe('x');
    expect(appendLocked('x', 'speech-segmenter')).toBe('x');
  });
});

describe('automatic tightening', () => {
  it('CSET-042: a present minor is detected; adults, places, and unknown IDs are not', () => {
    expect(minorInvolved(entities, ['pc.wren', 'npc.odette'])).toBe(false);
    expect(minorInvolved(entities, ['pc.wren', 'npc.pip'])).toBe(true);
    expect(minorInvolved(entities, ['npc.unknown'])).toBe(false);
    expect(minorInvolved(entities, [])).toBe(false);
  });

  it('CSET-042, CSET-061: with a minor, sexual is off and every other setting is kept', () => {
    expect(effectiveSettings(allExplicit, true)).toEqual({ ...allExplicit, sexual: 'off' });
  });

  it('CSET-061: with only adults present, settings are unchanged', () => {
    const minor = minorInvolved(entities, ['pc.wren', 'npc.odette']);
    expect(effectiveSettings(allExplicit, minor)).toBe(allExplicit);
  });

  it('CSET-061: explicit routing is used for adults and never with a minor involved', () => {
    expect(usesExplicitRoles(allExplicit, false)).toBe(true);
    expect(usesExplicitRoles(allExplicit, true)).toBe(false);
    expect(usesExplicitRoles(tone.content, false)).toBe(false);
  });

  it('CSET-042, CSET-061: with a minor the floor appears twice, the second at the end of the task', () => {
    const instructions = appendLocked('You are the narrator.', 'narrator');
    const task = appendFloorToTask('Write the narration.', 'narrator', true);
    expect(count(`${instructions}\n\n${task}`, HARD_FLOOR)).toBe(2);
    expect(task.endsWith(HARD_FLOOR)).toBe(true);
  });

  it('CSET-061: with only adults the floor appears once', () => {
    const instructions = appendLocked('You are the narrator.', 'narrator');
    const task = appendFloorToTask('Write the narration.', 'narrator', false);
    expect(task).toBe('Write the narration.');
    expect(count(`${instructions}\n\n${task}`, HARD_FLOOR)).toBe(1);
  });

  it('CSET-042: the task-tier floor follows FLOOR_ROLES', () => {
    expect(appendFloorToTask('x', 'embedder', true)).toBe('x');
  });
});

describe('content-settings wording', () => {
  it('CSET-010: the default wording matches the table in 13-content-settings §3', () => {
    const spec = readFileSync(path.join(repoRoot, 'spec/13-content-settings.md'), 'utf8');
    for (const category of CONTENT_CATEGORIES) {
      const row = spec.split(/\r?\n/).find((line) => line.startsWith(`| ${category} |`));
      const cells = (row ?? '').split('|').map((cell) => cell.trim());
      // The row is "| category | off | fade-to-black | moderate | explicit |".
      expect(cells.slice(2, 6), category).toEqual(
        IntensityLevelSchema.options.map((level) => DEFAULT_WORDING[category][level]),
      );
    }
  });

  it('CSET-060: every category renders at every level', () => {
    for (const category of CONTENT_CATEGORIES) {
      for (const level of IntensityLevelSchema.options) {
        const rendered = renderContentSettings({ ...tone.content, [category]: level });
        expect(rendered).toContain(`: ${DEFAULT_WORDING[category][level]}`);
      }
    }
  });

  it('CSET-010: one line per category, in order, each labeled', () => {
    const rendered = renderContentSettings({ ...allExplicit, lines: [], veils: [] });
    expect(rendered.split('\n').map((line) => line.split(':')[0])).toEqual([
      '- Violence',
      '- Gore',
      '- Sexual',
      '- Language',
      '- Disturbing',
    ]);
  });

  it('CSET-002, CSET-060: lines and veils render verbatim, after the categories', () => {
    expect(renderContentSettings(allExplicit).split('\n').slice(5)).toEqual([
      '- Never include, under any circumstances: harm to children.',
      '- These may happen in the story but only off-page, never described: torture; self-harm.',
    ]);
  });

  it('CSET-002: the reference tone renders five categories and its one veil', () => {
    const lines = renderContentSettings(tone.content).split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe(
      '- These may happen in the story but only off-page, never described: harm to animals.',
    );
  });
});

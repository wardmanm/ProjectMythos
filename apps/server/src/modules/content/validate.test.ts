import path from 'node:path';
import { RulesetSchema } from '@mythos/contracts/content';
import { beforeAll, describe, expect, it } from 'vitest';
import { packSummary } from './summaries';
import {
  emptySource,
  issuesIn,
  referenceSources,
  validate,
  withFile,
  withReplaced,
} from './test-pack';
import type { SourceFiles } from './types';
import { checkLibraries } from './validate';

let pack: SourceFiles;
let builtIn: SourceFiles;
let standardText: string;
beforeAll(async () => {
  ({ pack, builtIn } = await referenceSources());
  standardText = builtIn.files.get('rulesets/ruleset.standard.json') ?? '';
});

/** A copy of the standard ruleset with a new ID, and any top-level fields replaced. */
function rulesetJson(id: string, changes: Record<string, unknown> = {}): string {
  const standard = RulesetSchema.parse(JSON.parse(standardText));
  return JSON.stringify({ ...standard, id, ...changes });
}

const userLibrary = (files: Record<string, string>): SourceFiles =>
  Object.entries(files).reduce(
    (source, [relative, text]) => withFile(source, relative, text),
    emptySource(path.join('/data', 'library')),
  );

const USES_HOUSE = [
  'setting.json',
  '"rulesetId": "ruleset.standard"',
  '"rulesetId": "ruleset.house"',
] as const;

describe('validatePack', () => {
  it('SCH-010: a pack ruleset.standard wins over the built-in one, and the shadowing is listed', () => {
    const own = withFile(
      pack,
      'rulesets/ruleset.standard.json',
      rulesetJson('ruleset.standard', { name: 'Brinemoor Standard' }),
    );
    const { issues, shadowings, content } = validate(own, builtIn);
    expect(issues).toEqual([]);
    expect(shadowings).toEqual([
      {
        id: 'ruleset.standard',
        file: 'rulesets/ruleset.standard.json',
        shadows: 'content-library/rulesets/ruleset.standard.json',
      },
    ]);
    const winner = content.definitions.rulesets.get('ruleset.standard');
    expect(winner?.source).toBe('pack');
    expect(winner?.definition?.name).toBe('Brinemoor Standard');
  });

  it('SCH-010: a user-library definition shadows the built-in one with its ID', () => {
    const user = userLibrary({ 'rulesets/ruleset.standard.json': rulesetJson('ruleset.standard') });
    const libraries = checkLibraries(user, builtIn);
    expect(libraries.shadowings).toEqual([
      {
        id: 'ruleset.standard',
        file: 'library/rulesets/ruleset.standard.json',
        shadows: 'content-library/rulesets/ruleset.standard.json',
      },
    ]);
    expect(libraries.definitions.rulesets.get('ruleset.standard')?.source).toBe('user');
  });

  it('SCH-012: a ruleset in the user library is offered after the pack and before the built-in ones', () => {
    const user = userLibrary({ 'rulesets/ruleset.house.json': rulesetJson('ruleset.house') });
    const { content, issues } = validate(pack, builtIn, user);
    expect(packSummary(content, issues).rulesets.map((option) => option.id)).toEqual([
      'ruleset.house',
      'ruleset.d10-pool',
      'ruleset.d20',
      'ruleset.standard',
      'ruleset.two-dice',
    ]);
  });

  it('RUL-002: a default ruleset with issues blocks the pack', () => {
    const house = rulesetJson('ruleset.house', {
      stats: { ...RulesetSchema.parse(JSON.parse(standardText)).stats, default: 9 },
    });
    const broken = withReplaced(
      withFile(pack, 'rulesets/ruleset.house.json', house),
      ...USES_HOUSE,
    );
    const { issues } = validate(broken, builtIn);
    expect(issues).toEqual([
      {
        file: 'rulesets/ruleset.house.json',
        path: '',
        message: 'stats.default: outside stats.min..max',
      },
    ]);
  });

  it('RUL-002: a broken library ruleset is offered to no pack, and blocks only a pack that uses it', () => {
    const standard = RulesetSchema.parse(JSON.parse(standardText));
    const critical = { type: 'faces', face: 7, count: 2 };
    const house = rulesetJson('ruleset.house', { dice: { ...standard.dice, critical } });
    const user = userLibrary({ 'rulesets/ruleset.house.json': house });
    const unused = validate(pack, builtIn, user);
    expect(unused.issues).toEqual([]);
    expect(
      packSummary(unused.content, unused.issues).rulesets.map((option) => option.id),
    ).not.toContain('ruleset.house');

    const uses = validate(withReplaced(pack, ...USES_HOUSE), builtIn, user);
    expect(uses.issues).toEqual([
      {
        file: 'library/rulesets/ruleset.house.json',
        path: '',
        message: 'dice.critical.face: larger than dice.sides',
      },
    ]);
  });

  it('SCH-101: a problem in a library definition the pack uses is reported under its library file', () => {
    const gregorian = builtIn.files.get('calendars/calendar.gregorian.json') ?? '';
    const typo = gregorian.replace('"weekdays"', '"weekdayz"');
    const user = userLibrary({ 'calendars/calendar.gregorian.json': typo });
    const { issues } = validate(pack, builtIn, user);
    expect(issues).toEqual([
      {
        file: 'library/calendars/calendar.gregorian.json',
        path: 'weekdays',
        message: 'Invalid input: expected array, received undefined',
      },
      {
        file: 'library/calendars/calendar.gregorian.json',
        path: 'weekdayz',
        message: 'unknown key "weekdayz"',
      },
    ]);
  });

  it('SCH-100: a library tone profile naming a broken theme is not offered', () => {
    const brine = builtIn.files.get('themes/theme.brine.json') ?? '';
    const dim = brine.replace(/"text": "#[0-9a-fA-F]{6}"/g, '"text": "#777777"');
    const user = userLibrary({
      'themes/theme.house.json': dim.replace('"theme.brine"', '"theme.house"'),
    });
    const { content, issues } = validate(pack, builtIn, user);
    expect(issues).toEqual([]);
    const tones = packSummary(content, issues).toneProfiles.map((option) => option.id);
    // tone.adventure names theme.house, which the user library's broken copy shadows.
    expect(tones).toEqual([
      'tone.coastal-mystery',
      'tone.grimdark',
      'tone.romance',
      'tone.science-fiction',
    ]);
    expect(
      issuesIn(
        checkLibraries(user, builtIn).issues.references,
        'content-library/tone-profiles/tone.adventure.json',
      ),
    ).toEqual([
      {
        path: 'themeId',
        message: '"theme.house" has problems of its own, in library/themes/theme.house.json',
      },
    ]);
  });

  it('SCH-103: validating the same files twice gives deep-equal results', () => {
    const broken = withReplaced(pack, 'entities/characters/pc.wren.json', '"str": 2', '"str": 3');
    expect(validate(broken, builtIn)).toEqual(validate(broken, builtIn));
    expect(validate(broken, builtIn).issues).toHaveLength(1);
  });
});

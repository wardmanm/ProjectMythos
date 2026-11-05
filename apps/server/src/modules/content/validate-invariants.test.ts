import { RulesetSchema } from '@mythos/contracts/content';
import { beforeAll, describe, expect, it } from 'vitest';
import { issuesIn, referenceSources, validate, withFile, withReplaced } from './test-pack';
import type { SourceFiles } from './types';

let pack: SourceFiles;
let builtIn: SourceFiles;
beforeAll(async () => {
  ({ pack, builtIn } = await referenceSources());
});

const WREN = 'entities/characters/pc.wren.json';
const VAREK = 'entities/characters/npc.varek.json';

function withStartingStatuses(statuses: unknown[]): SourceFiles {
  const json = `"startingStatuses": ${JSON.stringify(statuses)}, "startingLocationId"`;
  return withReplaced(pack, VAREK, '"startingLocationId"', json);
}

describe('definition invariants', () => {
  it('SCH-062, RUL-002: every rulesetIssues problem in a pack ruleset is reported under its file', () => {
    const standard = RulesetSchema.parse(
      JSON.parse(builtIn.files.get('rulesets/ruleset.standard.json') ?? ''),
    );
    const house = {
      ...standard,
      id: 'ruleset.house',
      stats: { ...standard.stats, default: 9 },
      dice: { ...standard.dice, critical: { type: 'faces', face: 7, count: 2 } },
      clocks: { ...standard.clocks, minSegments: 8, maxSegments: 6 },
    };
    const broken = withFile(pack, 'rulesets/ruleset.house.json', JSON.stringify(house));
    expect(issuesIn(validate(broken, builtIn).issues, 'rulesets/ruleset.house.json')).toEqual([
      { path: '', message: 'stats.default: outside stats.min..max' },
      { path: '', message: 'dice.critical.face: larger than dice.sides' },
      { path: '', message: 'clocks: minSegments above maxSegments' },
      { path: '', message: 'statChange.clockSegments: outside clocks.minSegments..maxSegments' },
    ]);
  });

  it("TIME-004: a pack calendar's calendarIssues are reported under its file", () => {
    const gregorian = builtIn.files.get('calendars/calendar.gregorian.json') ?? '';
    const harvest = gregorian
      .replace('"calendar.gregorian"', '"calendar.harvest"')
      .replace('{ "name": "night", "startHour": 0 }', '{ "name": "night", "startHour": 1 }')
      .replace('{year} ({timeOfDay})', '{year} ({season})');
    const broken = withFile(pack, 'calendars/calendar.harvest.json', harvest);
    expect(issuesIn(validate(broken, builtIn).issues, 'calendars/calendar.harvest.json')).toEqual([
      { path: '', message: 'timesOfDay: must start at hour 0' },
      { path: '', message: 'format: unknown token {season}' },
    ]);
  });

  it('UI-031: a pack theme below contrast is an issue under its file', () => {
    const brine = builtIn.files.get('themes/theme.brine.json') ?? '';
    const dim = brine
      .replace('"theme.brine"', '"theme.dim"')
      .replace(/"textMuted": "#[0-9a-fA-F]{6}"/g, '"textMuted": "#555555"');
    const issues = validate(withFile(pack, 'themes/theme.dim.json', dim), builtIn).issues;
    const messages = issuesIn(issues, 'themes/theme.dim.json').map((issue) => issue.message);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.startsWith('palettes.dark: textMuted on '))).toBe(
      true,
    );
  });
});

describe('dates', () => {
  it("SCH-070: a scenario that starts before the setting's epoch is an issue", () => {
    const broken = withReplaced(
      pack,
      'scenarios/scenario.arrival.json',
      '"year": 1874',
      '"year": 1869',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: 'scenarios/scenario.arrival.json',
        path: 'start',
        message: "is before the setting's epoch",
      },
    ]);
  });

  it('SCH-091: a dated history entry before the epoch is an issue; an undated one is fine', () => {
    const broken = withReplaced(
      pack,
      'history.json',
      '{"year": 1874, "month": 9, "day": 3}',
      '{"year": 1869, "month": 9, "day": 3}',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      { file: 'history.json', path: 'entries.0.when', message: "is before the setting's epoch" },
    ]);
    // entries.3 (varek-debt) has no `when`, and the reference pack has no issues.
    expect(validate(pack, builtIn).issues).toEqual([]);
  });

  it('SCH-091: a date that does not exist on the calendar is an issue', () => {
    const broken = withReplaced(
      pack,
      'history.json',
      '{"year": 1874, "month": 9, "day": 3}',
      '{"year": 1874, "month": 9, "day": 31}',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      { file: 'history.json', path: 'entries.0.when', message: 'September 1874 has 30 days' },
    ]);
  });
});

describe('characters and places', () => {
  it('SCH-072: a premade PC over statPoints is an issue', () => {
    const broken = withReplaced(pack, WREN, '"str": 2', '"str": 3');
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: WREN,
        path: 'stats',
        message: 'the ratings add up to 16; a new PC in ruleset.standard has 15 points',
      },
    ]);
  });

  it('SCH-072: a premade PC outside the starting range is an issue', () => {
    const broken = withReplaced(
      withReplaced(pack, WREN, '"str": 2', '"str": 1'),
      WREN,
      '"int": 4',
      '"int": 5',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: WREN,
        path: 'stats.int',
        message: "5 is outside ruleset.standard's starting range 1..4",
      },
    ]);
  });

  it("CON-024: a stat block rates exactly the default ruleset's stats, within its range", () => {
    const broken = withReplaced(pack, VAREK, '"str": 3, "end": 3', '"str": 6, "wis": 3');
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: VAREK,
        path: 'stats',
        message: 'missing end; ruleset.standard rates str, end, dex, int, cha',
      },
      { file: VAREK, path: 'stats.str', message: "6 is outside ruleset.standard's range 1..5" },
      { file: VAREK, path: 'stats.wis', message: '"wis" is not a stat in ruleset.standard' },
    ]);
  });

  it('CON-020, CON-024: starting statuses have levels as their kind needs, and known tags', () => {
    const broken = withStartingStatuses([
      { name: 'Bad Knee', kind: 'harm', tags: ['physical'] },
      { name: 'Nervous', kind: 'condition', level: 1, tags: ['mental'] },
      { name: 'Doomed', kind: 'harm', level: 5, tags: ['spiritual'] },
      { name: 'Tired', kind: 'harm', level: 1, tags: ['physical'] },
    ]);
    expect(issuesIn(validate(broken, builtIn).issues, VAREK)).toEqual([
      { path: 'startingStatuses.0.level', message: 'a harm needs a level' },
      { path: 'startingStatuses.1.level', message: 'a condition has no level' },
      { path: 'startingStatuses.2.level', message: "5 is above ruleset.standard's fatal level, 4" },
      {
        path: 'startingStatuses.2.tags.0',
        message: '"spiritual" is not a harm tag in ruleset.standard',
      },
    ]);
  });

  it('SCH-100: places whose parents form a cycle are an issue for each place in it', () => {
    const broken = withReplaced(
      pack,
      'entities/places/place.brinemoor.json',
      '"parentPlaceId": null',
      '"parentPlaceId": "place.harbor"',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: 'entities/places/place.brinemoor.json',
        path: 'parentPlaceId',
        message: 'places form a cycle: place.brinemoor → place.harbor → place.brinemoor',
      },
      {
        file: 'entities/places/place.harbor.json',
        path: 'parentPlaceId',
        message: 'places form a cycle: place.harbor → place.brinemoor → place.harbor',
      },
    ]);
  });
});

describe('history and relationships', () => {
  it('SCH-090: a duplicate history ref is an issue', () => {
    const broken = withReplaced(
      pack,
      'history.json',
      '"ref": "varek-debt"',
      '"ref": "merrow-lost"',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: 'history.json',
        path: 'entries.3.ref',
        message: '"merrow-lost" is already the ref of entries.0',
      },
    ]);
  });

  it('CON-070: a claim entry needs a claim, and only claim entries have one', () => {
    const broken = withReplaced(pack, 'history.json', '"kind": "claim"', '"kind": "speech"');
    expect(validate(broken, builtIn).issues).toEqual([
      { file: 'history.json', path: 'entries.2.claim', message: 'only a claim entry has "claim"' },
    ]);
  });

  it('SCH-092: an unknown dimension is an issue', () => {
    const broken = withReplaced(
      pack,
      'relationships.json',
      '"trust": 3, "affection": 2',
      '"trusst": 3, "affection": 2',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: 'relationships.json',
        path: 'relationships.0.dimensions.trusst',
        message: '"trusst" is not a dimension in ruleset.standard',
      },
    ]);
  });

  it("SCH-092: a value outside the default ruleset's range is an issue", () => {
    const broken = withReplaced(
      pack,
      'relationships.json',
      '"trust": 3, "affection": 2',
      '"trust": 30, "affection": 2',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: 'relationships.json',
        path: 'relationships.0.dimensions.trust',
        message: "30 is outside ruleset.standard's range -5..5",
      },
    ]);
  });

  it('CON-073: a relationship with oneself, or a repeated pair, is an issue', () => {
    const self = withReplaced(
      pack,
      'relationships.json',
      '"toId": "npc.varek"',
      '"toId": "npc.odette"',
    );
    expect(validate(self, builtIn).issues).toEqual([
      {
        file: 'relationships.json',
        path: 'relationships.0.toId',
        message: 'a relationship runs between two different characters',
      },
    ]);
    const varekToOdette = '"fromId": "npc.varek",\n      "toId": "npc.odette"';
    const repeated = withReplaced(
      pack,
      'relationships.json',
      varekToOdette,
      '"fromId": "npc.odette",\n      "toId": "npc.varek"',
    );
    expect(validate(repeated, builtIn).issues).toEqual([
      {
        file: 'relationships.json',
        path: 'relationships.1',
        message: 'npc.odette → npc.varek is already relationships.0',
      },
    ]);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { issuesIn, referenceSources, validate, withReplaced } from './test-pack';
import type { SourceFiles } from './types';

let pack: SourceFiles;
let builtIn: SourceFiles;
beforeAll(async () => {
  ({ pack, builtIn } = await referenceSources());
});

const ARRIVAL = 'scenarios/scenario.arrival.json';

describe('reference checks', () => {
  it('SCH-070: a scenario at an unknown place is an issue', () => {
    const broken = withReplaced(pack, ARRIVAL, '"place.gull-and-anchor"', '"place.nowhere"');
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: ARRIVAL,
        path: 'startPlaceId',
        message: '"place.nowhere" is not an entity in this pack',
      },
    ]);
  });

  it('SCH-070: a present entity that is not a character is an issue', () => {
    const broken = withReplaced(
      pack,
      ARRIVAL,
      '"presentEntityIds": ["npc.odette"]',
      '"presentEntityIds": ["npc.odette", "place.harbor"]',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: ARRIVAL,
        path: 'presentEntityIds.1',
        message: '"place.harbor" is a place; expected a pc or an npc',
      },
    ]);
  });

  it('SCH-071: a premade PC whose characterId names an npc is an issue', () => {
    const broken = withReplaced(
      pack,
      ARRIVAL,
      '"characterId": "pc.wren"',
      '"characterId": "npc.jory"',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      { file: ARRIVAL, path: 'pc.characterId', message: '"npc.jory" is an npc; expected a pc' },
    ]);
  });

  it('SCH-073: a scenario whose opening file is missing is an issue', () => {
    const broken = withReplaced(pack, ARRIVAL, '"scenarios/arrival.md"', '"scenarios/arrive.md"');
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: ARRIVAL,
        path: 'openingFile',
        message: '"scenarios/arrive.md" is not a file in the pack',
      },
    ]);
  });

  it('SCH-090: a dangling aboutRef is an issue', () => {
    const broken = withReplaced(
      pack,
      'history.json',
      '"aboutRef": "merrow-lost"',
      '"aboutRef": "merrow-gone"',
    );
    const issues = validate(broken, builtIn).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toEqual({
      file: 'history.json',
      path: 'entries.2.claim.aboutRef',
      message: '"merrow-gone" is not the ref of an entry in this file',
    });
  });

  it("SCH-010: a setting's definitions resolve through the pack and both libraries", () => {
    const broken = withReplaced(
      pack,
      'setting.json',
      '"calendarId": "calendar.gregorian"',
      '"calendarId": "calendar.harvest"',
    );
    expect(issuesIn(validate(broken, builtIn).issues, 'setting.json')).toEqual([
      {
        path: 'calendarId',
        message: '"calendar.harvest" is not a calendar in the pack or the libraries',
      },
    ]);
  });

  it('SCH-010: a tone profile naming an unknown theme is an issue', () => {
    const tone = 'tone-profiles/tone.coastal-mystery.json';
    const broken = withReplaced(pack, tone, '"theme.brine"', '"theme.briny"');
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: tone,
        path: 'themeId',
        message: '"theme.briny" is not a theme in the pack or the libraries',
      },
    ]);
  });

  it('SCH-100: items and relationships are still checked without the default ruleset', () => {
    const noRuleset = withReplaced(
      pack,
      'setting.json',
      '"rulesetId": "ruleset.standard"',
      '"rulesetId": "ruleset.house"',
    );
    const ledger = 'entities/items/item.harbor-ledger.json';
    const withPlace = withReplaced(noRuleset, ledger, '"place.harbor-office"', '"place.nowhere"');
    const broken = withReplaced(
      withPlace,
      'relationships.json',
      '"toId": "npc.varek"',
      '"toId": "npc.nobody"',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: ledger,
        path: 'startingLocation.placeId',
        message: '"place.nowhere" is not an entity in this pack',
      },
      {
        file: 'relationships.json',
        path: 'relationships.0.toId',
        message: '"npc.nobody" is not an entity in this pack',
      },
      {
        file: 'setting.json',
        path: 'defaults.rulesetId',
        message: '"ruleset.house" is not a ruleset in the pack or the libraries',
      },
    ]);
  });
});

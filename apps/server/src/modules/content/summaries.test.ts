import path from 'node:path';
import { PackSummarySchema } from '@mythos/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { listedThemes, packSummary } from './summaries';
import { emptySource, referenceSources, validate, withFile, withReplaced } from './test-pack';
import type { SourceFiles } from './types';
import { BUILT_IN_LIBRARY, PACK, USER_LIBRARY } from './validate';

let pack: SourceFiles;
let builtIn: SourceFiles;
beforeAll(async () => {
  ({ pack, builtIn } = await referenceSources());
});

function summaryOf(source: SourceFiles) {
  const { content, issues } = validate(source, builtIn);
  return PackSummarySchema.parse(packSummary(content, issues));
}

describe('packSummary', () => {
  it('SCH-010: the reference pack offers Arrival with Wren, Coastal Mystery and four more tone profiles, and four rulesets', () => {
    const summary = summaryOf(pack);
    expect(summary).toMatchObject({
      packId: 'reference',
      name: 'Brinemoor (Reference Pack)',
      version: '0.1.0',
      settingName: 'Brinemoor',
      defaults: { toneProfileId: 'tone.coastal-mystery', rulesetId: 'ruleset.standard' },
      issues: [],
    });
    expect(summary.scenarios).toEqual([
      {
        id: 'scenario.arrival',
        name: 'Arrival',
        description:
          'You arrive in Brinemoor on the evening coach, looking for your missing brother.',
        pcMode: 'either',
        premadePc: { id: 'pc.wren', name: 'Wren Ashby' },
      },
    ]);
    expect(summary.toneProfiles.map((option) => option.name)).toEqual([
      'Coastal Mystery',
      'Adventure',
      'Grimdark',
      'Romance',
      'Science Fiction',
    ]);
    expect(summary.rulesets.map((option) => option.id)).toEqual([
      'ruleset.d10-pool',
      'ruleset.d20',
      'ruleset.standard',
      'ruleset.two-dice',
    ]);
  });

  it('SCH-102: a broken pack is listed with its issues and whatever parsed', () => {
    const broken = withReplaced(pack, 'setting.json', '"calendarId"', '"calendarid"');
    const summary = summaryOf(broken);
    expect(summary.settingName).toBeNull();
    expect(summary.name).toBe('Brinemoor (Reference Pack)');
    expect(summary.scenarios.map((scenario) => scenario.id)).toEqual(['scenario.arrival']);
    expect(summary.defaults).toEqual({ toneProfileId: null, rulesetId: 'ruleset.standard' });
    expect(summary.issues).toEqual([
      {
        file: 'setting.json',
        path: 'calendarId',
        message: 'Invalid input: expected string, received undefined',
      },
      { file: 'setting.json', path: 'calendarid', message: 'unknown key "calendarid"' },
    ]);
  });

  it('SCH-102: a pack whose manifest fails is listed under its folder name', () => {
    const broken = withReplaced(pack, 'pack.json', '"version": "0.1.0"', '"version": "one"');
    const summary = summaryOf(broken);
    expect(summary).toMatchObject({
      packId: 'reference',
      name: 'reference',
      version: '',
      description: '',
    });
    expect(summary.issues.map((issue) => `${issue.file}: ${issue.path}`)).toEqual([
      'pack.json: version',
    ]);
  });
});

describe('listedThemes', () => {
  const brine = () => builtIn.files.get('themes/theme.brine.json') ?? '';

  it('UI-031: a theme below contrast is left out; the first theme with an ID wins', () => {
    const user = withFile(
      emptySource(path.join(path.sep, 'data', 'library')),
      'themes/theme.brine.json',
      brine().replace('"name": "Brine"', '"name": "My Brine"'),
    );
    const dim = brine()
      .replace('"theme.brine"', '"theme.dim"')
      .replace(/"textMuted": "#[0-9a-fA-F]{6}"/g, '"textMuted": "#555555"');
    const fog = brine().replace('"theme.brine"', '"theme.fog"');
    const packThemes = withFile(
      withFile(pack, 'themes/theme.dim.json', dim),
      'themes/theme.fog.json',
      fog,
    );
    const themes = listedThemes([
      { files: builtIn, label: BUILT_IN_LIBRARY },
      { files: user, label: USER_LIBRARY },
      { files: packThemes, label: PACK },
    ]);
    expect(themes.map((theme) => theme.id)).toEqual([
      'theme.ash',
      'theme.brine',
      'theme.hearth',
      'theme.high-contrast',
      'theme.house',
      'theme.signal',
      'theme.fog',
    ]);
    expect(themes.find((theme) => theme.id === 'theme.brine')?.name).toBe('Brine');
  });
});

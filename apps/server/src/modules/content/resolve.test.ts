import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defaultRulesetId, mergeDefinitions, templatesDir } from './resolve';
import { emptySource, referenceSources, withFile, withTemplateDirs } from './test-pack';
import type { SourceFiles } from './types';
import { parseDefinitions } from './validate-files';
import { BUILT_IN_LIBRARY, USER_LIBRARY } from './validate';

let builtIn: SourceFiles;
beforeAll(async () => {
  ({ builtIn } = await referenceSources());
});

const user = (files: Record<string, string>): SourceFiles =>
  Object.entries(files).reduce(
    (source, [relative, text]) => withFile(source, relative, text),
    emptySource(path.join(path.sep, 'data', 'library')),
  );

describe('mergeDefinitions', () => {
  it("SCH-010: the first source's definitions come first, then the rest, and each shadowing is listed", () => {
    const d20 = builtIn.files.get('rulesets/ruleset.d20.json') ?? '';
    const mine = user({
      'rulesets/ruleset.d20.json': d20.replace('"Heroic d20"', '"My d20"'),
      'rulesets/ruleset.alpha.json': d20.replace('"ruleset.d20"', '"ruleset.alpha"'),
    });
    const { set, shadowings } = mergeDefinitions(
      parseDefinitions(mine, USER_LIBRARY).set,
      parseDefinitions(builtIn, BUILT_IN_LIBRARY).set,
    );
    expect([...set.rulesets.keys()]).toEqual([
      'ruleset.alpha',
      'ruleset.d20',
      'ruleset.d10-pool',
      'ruleset.standard',
      'ruleset.two-dice',
    ]);
    expect(set.rulesets.get('ruleset.d20')?.definition?.name).toBe('My d20');
    expect(shadowings).toEqual([
      {
        id: 'ruleset.d20',
        file: 'library/rulesets/ruleset.d20.json',
        shadows: 'content-library/rulesets/ruleset.d20.json',
      },
    ]);
  });

  it('SCH-010: with no setting, or none named, the default ruleset is ruleset.standard (SCH-114)', () => {
    expect(defaultRulesetId(null)).toBe('ruleset.standard');
  });
});

describe('templatesDir', () => {
  it("SCH-023: a ruleset's templates folder is the absolute path beside its file, or null", () => {
    const withTemplates = withTemplateDirs(builtIn, ['rulesets/ruleset.d20/templates']);
    const { set } = parseDefinitions(withTemplates, BUILT_IN_LIBRARY);
    const sources = {
      pack: emptySource('/pack'),
      user: emptySource('/user'),
      'built-in': withTemplates,
    };
    const d20 = set.rulesets.get('ruleset.d20');
    const standard = set.rulesets.get('ruleset.standard');
    if (d20 === undefined || standard === undefined) throw new Error('built-in rulesets missing');
    expect(templatesDir(d20, 'rulesets', sources)).toBe(
      path.join(builtIn.root, 'rulesets', 'ruleset.d20', 'templates'),
    );
    expect(templatesDir(standard, 'rulesets', sources)).toBeNull();
  });
});

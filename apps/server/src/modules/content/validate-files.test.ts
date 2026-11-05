import { beforeAll, describe, expect, it } from 'vitest';
import { issuesIn, referenceSources, withFile, withoutFile, withReplaced } from './test-pack';
import type { SourceFiles } from './types';
import { parseDefinitions, parsePackFiles } from './validate-files';

let pack: SourceFiles;
let builtIn: SourceFiles;
beforeAll(async () => {
  ({ pack, builtIn } = await referenceSources());
});

const VAREK = 'entities/characters/npc.varek.json';

describe('parsePackFiles', () => {
  it('SCH-001, SCH-011, SCH-020, SCH-021, SCH-022: the reference pack has no file issues', () => {
    const files = parsePackFiles(pack, 'reference');
    expect(files.issues).toEqual([]);
    expect(files.entities.size).toBe(27);
    expect(files.scenarios.has('scenario.arrival')).toBe(true);
  });

  it('SCH-011: two files with one ID in one source are an issue', () => {
    const copy = pack.files.get(VAREK) ?? '';
    const broken = withFile(pack, 'entities/characters/npc.varek-copy.json', copy);
    const { issues, entities } = parsePackFiles(broken, 'reference');
    expect(issuesIn(issues, 'entities/characters/npc.varek.json')).toEqual([
      {
        path: 'id',
        message: '"npc.varek" is already the id of entities/characters/npc.varek-copy.json',
      },
    ]);
    // The first file in `cmp` order wins; the second is also named wrongly (SCH-020).
    expect(issuesIn(issues, 'entities/characters/npc.varek-copy.json')).toEqual([
      { path: 'id', message: '"npc.varek" does not match the file name "npc.varek-copy"' },
    ]);
    expect(entities.get('npc.varek')?.file).toBe('entities/characters/npc.varek-copy.json');
  });

  it('SCH-011: two definitions with one ID in one library are an issue', () => {
    const d20 = builtIn.files.get('rulesets/ruleset.d20.json') ?? '';
    const twin = withFile(builtIn, 'rulesets/ruleset.zz.json', d20);
    const { set, issues } = parseDefinitions(twin, { name: 'built-in', prefix: 'content-library' });
    expect(issuesIn(issues, 'content-library/rulesets/ruleset.zz.json')).toEqual([
      { path: 'id', message: '"ruleset.d20" does not match the file name "ruleset.zz"' },
      {
        path: 'id',
        message: '"ruleset.d20" is already the id of content-library/rulesets/ruleset.d20.json',
      },
    ]);
    expect(set.rulesets.get('ruleset.d20')?.files).toEqual([
      'content-library/rulesets/ruleset.d20.json',
      'content-library/rulesets/ruleset.zz.json',
    ]);
  });

  it('SCH-020: an ID that does not match its file name is an issue', () => {
    const broken = withReplaced(pack, VAREK, '"id": "npc.varek"', '"id": "npc.varek-holm"');
    const { issues } = parsePackFiles(broken, 'reference');
    expect(issuesIn(issues, VAREK)).toEqual([
      { path: 'id', message: '"npc.varek-holm" does not match the file name "npc.varek"' },
    ]);
  });

  it("SCH-020: a manifest ID that does not match the pack's folder is an issue", () => {
    const { issues } = parsePackFiles(pack, 'brinemoor');
    expect(issuesIn(issues, 'pack.json')).toEqual([
      { path: 'id', message: `"reference" does not match the pack's folder name "brinemoor"` },
    ]);
  });

  it('SCH-020: a pack without pack.json or setting.json says so', () => {
    const bare = withoutFile(withoutFile(pack, 'pack.json'), 'setting.json');
    const { issues, manifest, setting } = parsePackFiles(bare, 'reference');
    expect(manifest).toBeNull();
    expect(setting).toBeNull();
    expect(issues).toEqual([
      { file: 'pack.json', path: '', message: 'missing: every pack has one' },
      { file: 'setting.json', path: '', message: 'missing: every pack has one' },
    ]);
  });

  it('SCH-021: an entity without a .md file has empty canon', () => {
    const { entities } = parsePackFiles(pack, 'reference');
    expect(pack.files.has('entities/places/place.harbor.md')).toBe(false);
    expect(entities.get('place.harbor')?.canon).toBe('');
    expect(entities.get('npc.varek')?.canon).toBe(
      pack.files.get('entities/characters/npc.varek.md'),
    );
  });

  it('SCH-021: two Common knowledge sections are an issue in the canon file', () => {
    const canonFile = 'entities/characters/npc.varek.md';
    const canon = `${pack.files.get(canonFile) ?? ''}\n## Common knowledge\n\nAgain.\n`;
    const { issues } = parsePackFiles(withFile(pack, canonFile, canon), 'reference');
    expect(issues).toEqual([
      {
        file: canonFile,
        path: '',
        message: 'has 2 "## Common knowledge" sections; keep one',
      },
    ]);
  });

  it('SCH-022: an npc in entities/places/ is an issue', () => {
    const moved = withFile(
      withoutFile(pack, VAREK),
      'entities/places/npc.varek.json',
      pack.files.get(VAREK) ?? '',
    );
    const { issues, entities } = parsePackFiles(moved, 'reference');
    expect(issuesIn(issues, 'entities/places/npc.varek.json')).toEqual([
      { path: 'kind', message: 'an npc does not belong in entities/places/' },
    ]);
    // It still parsed, so references to Varek resolve and nothing else is reported.
    expect(entities.has('npc.varek')).toBe(true);
  });

  it('SCH-080: a 601-character personality is an issue at personality', () => {
    const personality = 'Careful. '.repeat(67).slice(0, 601);
    const broken = withReplaced(
      pack,
      VAREK,
      '"personality": "Courteous, careful, never volunteers anything. Deflects with dry humor. Becomes very still when frightened."',
      `"personality": "${personality}"`,
    );
    const { issues, entities } = parsePackFiles(broken, 'reference');
    expect(issuesIn(issues, VAREK)).toEqual([
      { path: 'personality', message: 'Too big: expected string to have <=600 characters' },
    ]);
    expect(entities.has('npc.varek')).toBe(false);
  });
});

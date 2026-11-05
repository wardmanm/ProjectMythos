import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSources } from './sources';

describe('defaultSources', () => {
  it('SCH-010: packs come from the repository, then the data directory; then the user and built-in libraries', () => {
    const dataDir = path.resolve('some-data-dir');
    const sources = defaultSources(dataDir);
    const [repositoryPacks, dataPacks] = sources.packFolders;
    expect(sources.packFolders).toHaveLength(2);
    expect(existsSync(path.join(repositoryPacks ?? '', 'reference', 'pack.json'))).toBe(true);
    expect(dataPacks).toBe(path.join(dataDir, 'content-packs'));
    expect(sources.userLibrary).toBe(path.join(dataDir, 'library'));
    expect(existsSync(path.join(sources.builtInLibrary, 'rulesets', 'ruleset.standard.json'))).toBe(
      true,
    );
    expect(sources.engineTemplates).toBe(path.join(sources.builtInLibrary, 'templates'));
    expect(path.isAbsolute(sources.builtInLibrary)).toBe(true);
  });
});

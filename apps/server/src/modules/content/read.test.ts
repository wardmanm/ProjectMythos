import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listFolders, normalizeText, readSource, readSourceIfPresent } from './read';
import { removeTempDirs, tempDir } from './test-pack';

afterEach(removeTempDirs);

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe('readSource', () => {
  it('CONV-083: text is read with LF line endings and no BOM', () => {
    expect(normalizeText('﻿{\r\n  "a": 1\r\n}\r')).toBe('{\n  "a": 1\n}\n');
    expect(normalizeText('no change\n')).toBe('no change\n');
  });

  it('SCH-103: every .json and .md file is read by forward-slash path, in cmp order', async () => {
    const root = tempDir();
    write(root, 'b.json', '﻿{"b": 1}\r\n');
    write(root, 'a/z.md', '# Z\r\n');
    write(root, 'a-b.json', '{}');
    write(root, 'notes.txt', 'not content');
    write(root, '.git/config.json', '{}');
    const source = await readSource(root);
    // '-' sorts before '/', so a-b.json comes before the a/ folder's files.
    expect([...source.files]).toEqual([
      ['a-b.json', '{}'],
      ['a/z.md', '# Z\n'],
      ['b.json', '{"b": 1}\n'],
    ]);
    expect(source.root).toBe(root);
  });

  it('SCH-023: templates folders are noted, not read; media/ and fonts/ are skipped', async () => {
    const root = tempDir();
    write(root, 'templates/narrator.md', 'Narrate.');
    write(root, 'tone-profiles/tone.x/templates/tone.md', 'Tone.');
    write(root, 'tone-profiles/tone.x.json', '{}');
    write(root, 'media/portrait.json', '{}');
    write(root, 'fonts/LICENSE.md', 'OFL');
    const source = await readSource(root);
    expect([...source.files.keys()]).toEqual(['tone-profiles/tone.x.json']);
    expect(source.templateDirs).toEqual(['templates', 'tone-profiles/tone.x/templates']);
  });

  it('SCH-103: a missing user library reads as empty; a missing folder has no packs', async () => {
    const missing = path.join(tempDir(), 'library');
    expect(await readSourceIfPresent(missing)).toEqual({
      root: missing,
      files: new Map(),
      templateDirs: [],
    });
    expect(await listFolders(missing)).toEqual([]);
    await expect(readSource(missing)).rejects.toThrow();
  });

  it('SCH-103: pack folders are listed by name in cmp order, without files or dot-folders', async () => {
    const root = tempDir();
    write(root, 'zeta/pack.json', '{}');
    write(root, 'alpha/pack.json', '{}');
    write(root, '.hidden/pack.json', '{}');
    write(root, 'readme.md', 'Packs.');
    expect(await listFolders(root)).toEqual(['alpha', 'zeta']);
  });
});

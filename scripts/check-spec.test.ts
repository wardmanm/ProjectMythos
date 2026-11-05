// Proves the spec check (scripts/check-spec.ts) reports each kind of difference between
// the spec's fixtures and contracts and the repository's copies (OVR-030, OVR-033).
//
// Each test writes a small fake repository to os.tmpdir() and runs the script on it the
// way `pnpm check` does, so the exit code and the printed messages are what is tested.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts', 'check-spec.ts');

// One file in each source folder, and each single-file source; passingRepo() copies each
// one into the repository.
const sources: Record<string, string> = {
  'spec/fixtures/library/calendars/gregorian.json': '{ "id": "gregorian" }\n',
  'spec/fixtures/packs/reference/setting.json': '{ "name": "Brinemoor" }\n',
  'spec/reference/contracts/rules.ts': 'export const rules = 1;\n',
  'spec/reference/contracts/content/index.ts': 'export const content = 2;\n',
  'spec/reference/server-types/providers/types.ts': 'export type ProviderAdapter = object;\n',
};
// Where each source is copied, by path prefix: a folder, or a whole file path.
const copyTargets: Record<string, string> = {
  'spec/fixtures/library/': 'content-library/',
  'spec/fixtures/packs/reference/': 'content-packs/reference/',
  'spec/reference/contracts/': 'packages/contracts/src/',
  'spec/reference/server-types/providers/types.ts': 'apps/server/src/modules/providers/types.ts',
};

/** The sources and an exact copy of each: a repository the check passes. */
function passingRepo(): Map<string, string> {
  const files = new Map(Object.entries(sources));
  for (const [file, text] of Object.entries(sources)) {
    for (const [from, to] of Object.entries(copyTargets)) {
      if (file.startsWith(from)) files.set(to + file.slice(from.length), text);
    }
  }
  return files;
}

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Writes `files` to a fresh temporary repository and runs the spec check on it. */
function runCheck(files: Map<string, string>): { status: number | null; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'mythos-spec-'));
  tempRoots.push(root);
  for (const [file, text] of files) {
    const fullPath = path.join(root, file);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, text);
  }
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, root], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('spec check: library and pack fixtures', () => {
  it('OVR-030: exact copies pass', () => {
    const { status, output } = runCheck(passingRepo());
    expect(output).toContain('Spec check passed');
    expect(status).toBe(0);
  });

  it('OVR-030: a fixture with no copy is reported', () => {
    const files = passingRepo();
    files.delete('content-library/calendars/gregorian.json');
    const { status, output } = runCheck(files);
    expect(output).toContain('content-library/calendars/gregorian.json is missing');
    expect(status).toBe(1);
  });

  it('OVR-030: a copy one byte different is reported by name', () => {
    const files = passingRepo();
    files.set('content-packs/reference/setting.json', '{ "name": "Brinemoar" }\n');
    const { status, output } = runCheck(files);
    expect(output).toContain(
      'content-packs/reference/setting.json differs from spec/fixtures/packs/reference/setting.json',
    );
    expect(status).toBe(1);
  });

  it('OVR-030: extra files in a fixture copy are allowed', () => {
    const files = passingRepo();
    files.set('content-library/templates/narrator.md', 'An engine template.\n');
    expect(runCheck(files).status).toBe(0);
  });

  it('OVR-030: a missing fixture folder is reported rather than passing', () => {
    const files = passingRepo();
    files.delete('spec/fixtures/library/calendars/gregorian.json');
    const { status, output } = runCheck(files);
    expect(output).toContain('spec/fixtures/library is missing');
    expect(status).toBe(1);
  });
});

describe('spec check: contracts', () => {
  it('OVR-033: a contract that differs is reported by name', () => {
    const files = passingRepo();
    files.set('packages/contracts/src/rules.ts', 'export const rules = 3;\n');
    const { status, output } = runCheck(files);
    expect(output).toContain(
      'packages/contracts/src/rules.ts differs from spec/reference/contracts/rules.ts',
    );
    expect(status).toBe(1);
  });

  it('OVR-033: a contract with no copy is reported', () => {
    const files = passingRepo();
    files.delete('packages/contracts/src/content/index.ts');
    const { status, output } = runCheck(files);
    expect(output).toContain('packages/contracts/src/content/index.ts is missing');
    expect(status).toBe(1);
  });

  it('OVR-033: a contract file with no source is reported', () => {
    const files = passingRepo();
    files.set('packages/contracts/src/helpers.ts', 'export const helper = 4;\n');
    const { status, output } = runCheck(files);
    expect(output).toContain('packages/contracts/src/helpers.ts has no source');
    expect(status).toBe(1);
  });

  it('OVR-033: contract tests are left out on both sides', () => {
    const files = passingRepo();
    files.set('spec/reference/contracts/rules.test.ts', 'export const sourceTest = 5;\n');
    files.set('packages/contracts/src/views.test.ts', 'export const copyTest = 6;\n');
    expect(runCheck(files).status).toBe(0);
  });
});

describe('spec check: server types', () => {
  it('OVR-033: a server type copy one byte different fails, naming the file', () => {
    const files = passingRepo();
    files.set(
      'apps/server/src/modules/providers/types.ts',
      'export type ProviderAdapter = Object;\n',
    );
    const { status, output } = runCheck(files);
    expect(output).toContain(
      'apps/server/src/modules/providers/types.ts differs from spec/reference/server-types/providers/types.ts',
    );
    expect(status).toBe(1);
  });

  it('OVR-033: a server type with no copy is reported', () => {
    const files = passingRepo();
    files.delete('apps/server/src/modules/providers/types.ts');
    const { status, output } = runCheck(files);
    expect(output).toContain('apps/server/src/modules/providers/types.ts is missing');
    expect(status).toBe(1);
  });

  it('OVR-033: other files beside a server type copy are not checked', () => {
    const files = passingRepo();
    files.set('apps/server/src/modules/providers/registry.ts', 'export const registry = 7;\n');
    expect(runCheck(files).status).toBe(0);
  });
});

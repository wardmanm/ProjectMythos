// Proves that each boundary and restriction in eslint.config.js fires (CONV-121). Each
// test lints small code strings under fake file paths, once where the rule must report
// and once where it must stay quiet.
//
// The fake paths live in a throwaway copy of the repository layout in os.tmpdir(), so
// that relative imports resolve to real files, as boundaries needs. Type-aware rules are
// turned off: none of the rules under test needs type information, and the throwaway
// files belong to no tsconfig.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const serverModules = [
  'config',
  'storage',
  'events',
  'auth',
  'content',
  'providers',
  'memory',
  'context',
  'journal',
  'world',
  'turn',
  'media',
  'http',
];

// Files that imports in the tests point at.
const treeFiles = [
  'packages/contracts/src/index.ts',
  'packages/core/src/index.ts',
  'packages/core/src/dice.ts',
  'apps/server/src/app.ts',
  'apps/server/src/main.ts',
  'apps/server/src/cli/tool.ts',
  'apps/client/src/view.ts',
  'scripts/tool.ts',
  ...serverModules.flatMap((name) => [
    `apps/server/src/modules/${name}/index.ts`,
    `apps/server/src/modules/${name}/internal.ts`,
  ]),
];

let treeRoot = '';
let eslint: ESLint;

beforeAll(async () => {
  treeRoot = mkdtempSync(path.join(tmpdir(), 'mythos-lint-'));
  for (const file of treeFiles) {
    const fullPath = path.join(treeRoot, file);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, 'export const x = 1;\n');
  }
  const configUrl = pathToFileURL(path.join(repoRoot, 'eslint.config.js')).href;
  const { default: repoConfig } = (await import(configUrl)) as { default: Linter.Config[] };
  eslint = new ESLint({
    cwd: treeRoot,
    overrideConfigFile: true,
    overrideConfig: [
      ...repoConfig,
      tseslint.configs.disableTypeChecked,
      { settings: { 'boundaries/root-path': treeRoot } },
    ],
  });
});

afterAll(() => {
  rmSync(treeRoot, { recursive: true, force: true });
});

/** Lints `code` as if it were `file`, and returns how often `ruleId` reported. */
async function countReports(file: string, code: string, ruleId: string): Promise<number> {
  const results = await eslint.lintText(code, { filePath: path.join(treeRoot, file) });
  const messages = results.flatMap((result) => result.messages);
  const fatal = messages.filter((message) => message.ruleId === null);
  if (fatal.length > 0) {
    throw new Error(`${file} did not lint: ${fatal.map((m) => m.message).join('; ')}`);
  }
  return messages.filter((message) => message.ruleId === ruleId).length;
}

/** Asserts that `ruleId` reports on `code` in every file of `reports`, and in none of `quiet`. */
async function expectRule(
  ruleId: string,
  code: string,
  files: { reports: string[]; quiet: string[] },
): Promise<void> {
  for (const file of files.reports) {
    expect(await countReports(file, code, ruleId), `${ruleId} in ${file}`).toBeGreaterThan(0);
  }
  for (const file of files.quiet) {
    expect(await countReports(file, code, ruleId), `${ruleId} in ${file}`).toBe(0);
  }
}

/** Asserts that importing `source` from `file` is allowed or reported by boundaries. */
async function expectImport(file: string, source: string, allowed: boolean): Promise<void> {
  const code = `import { x } from '${source}';\nexport const y = x;\n`;
  const reports = await countReports(file, code, 'boundaries/dependencies');
  expect(reports, `${file} importing ${source}`).toBe(allowed ? 0 : 1);
}

describe('package boundaries', () => {
  it('CONV-121: contracts imports zod and nothing else', async () => {
    const file = 'packages/contracts/src/schema.ts';
    await expectImport(file, 'zod', true);
    await expectImport(file, '@mythos/core', false);
    await expectImport(file, 'react', false);
  });

  it('ARCH-010, CONV-121: core imports contracts and nothing else', async () => {
    const file = 'packages/core/src/rules.ts';
    await expectImport(file, '@mythos/contracts', true);
    await expectImport(file, '@mythos/contracts/content', true);
    await expectImport(file, './dice', true);
    await expectImport(file, '@mythos/server', false);
    await expectImport(file, '../../../apps/server/src/app', false);
    await expectImport(file, 'zod', false);
  });

  it('ARCH-010: core imports no Node built-ins outside tests', async () => {
    const file = 'packages/core/src/rules.ts';
    await expectImport(file, 'node:fs', false);
    await expectImport(file, 'fs', false);
    await expectImport('packages/core/src/rules.test.ts', 'node:fs', true);
  });

  it('CONV-121: the client imports contracts and npm packages, never core or the server', async () => {
    const file = 'apps/client/src/app.tsx';
    await expectImport(file, '@mythos/contracts', true);
    await expectImport(file, 'react', true);
    await expectImport(file, './view', true);
    await expectImport(file, '@mythos/core', false);
    await expectImport(file, '@mythos/server', false);
    await expectImport(file, '../../../packages/core/src/index', false);
    await expectImport(file, '../../server/src/app', false);
  });

  it('CONV-121: the server imports core and contracts, never the client', async () => {
    const file = 'apps/server/src/modules/memory/retrieval.ts';
    await expectImport(file, '@mythos/core', true);
    await expectImport(file, '@mythos/contracts', true);
    await expectImport(file, 'node:path', true);
    await expectImport(file, '@mythos/client', false);
    await expectImport(file, '../../../../client/src/view', false);
  });

  it('ARCH-007: scripts import no app code', async () => {
    const file = 'scripts/check.ts';
    await expectImport(file, '@mythos/contracts', true);
    await expectImport(file, 'node:fs', true);
    await expectImport(file, './tool', true);
    await expectImport(file, '@mythos/server', false);
    await expectImport(file, '../apps/server/src/app', false);
    await expectImport(file, '../apps/client/src/view', false);
  });
});

describe('server module boundaries', () => {
  it('ARCH-020: a module imports another module only through its index.ts', async () => {
    const file = 'apps/server/src/modules/storage/events-table.ts';
    await expectImport(file, '../config/index', true);
    await expectImport(file, '../config', true);
    await expectImport(file, '../config/internal', false);
    await expectImport(file, './internal', true);
  });

  it('ARCH-021: modules import only the modules their table row lists', async () => {
    await expectImport('apps/server/src/modules/storage/a.ts', '../config/index', true);
    await expectImport('apps/server/src/modules/config/a.ts', '../storage/index', false);
    await expectImport('apps/server/src/modules/events/a.ts', '../config/index', false);
    await expectImport('apps/server/src/modules/turn/a.ts', '../world/index', true);
    await expectImport('apps/server/src/modules/world/a.ts', '../turn/index', false);
    await expectImport('apps/server/src/modules/memory/a.ts', '../context/index', false);
    await expectImport('apps/server/src/modules/http/a.ts', '../media/index', true);
    await expectImport('apps/server/src/modules/storage/a.ts', '../../app', false);
  });

  it('ARCH-022: the composition root wires modules; cli files import only app.ts', async () => {
    await expectImport('apps/server/src/app.ts', './modules/turn/index', true);
    await expectImport('apps/server/src/main.ts', './modules/http/index', true);
    await expectImport('apps/server/src/app.ts', './modules/turn/internal', false);
    await expectImport('apps/server/src/cli/rebuild.ts', '../app', true);
    await expectImport('apps/server/src/cli/rebuild.ts', '@mythos/contracts', true);
    await expectImport('apps/server/src/cli/rebuild.ts', '../modules/storage/index', false);
    await expectImport('apps/server/src/cli/rebuild.ts', '../main', false);
  });
});

describe('code restrictions', () => {
  const coreFile = 'packages/core/src/clock.ts';
  const coreTest = 'packages/core/src/clock.test.ts';
  const serverFile = 'apps/server/src/modules/world/clock.ts';

  it('CONV-060: core never reads the clock or calls Math.random outside tests', async () => {
    for (const code of [
      'export const t = Date.now();\n',
      'export const d = new Date();\n',
      'export const r = Math.random();\n',
    ]) {
      await expectRule('no-restricted-syntax', code, {
        reports: [coreFile],
        quiet: [coreTest, serverFile],
      });
    }
  });

  it('CONV-070: console is allowed only in scripts and the server cli', async () => {
    await expectRule('no-console', "console.log('hello');\n", {
      reports: [serverFile, coreFile, 'apps/client/src/app.tsx'],
      quiet: ['scripts/check.ts', 'apps/server/src/cli/rebuild.ts'],
    });
  });

  it('CONV-087: localeCompare and Intl.Collator are allowed only in the client', async () => {
    for (const code of [
      "export const s = ['b', 'a'].sort((p, q) => p.localeCompare(q));\n",
      'export const c = new Intl.Collator();\n',
    ]) {
      await expectRule('no-restricted-syntax', code, {
        reports: [coreFile, serverFile, 'scripts/check.ts'],
        quiet: ['apps/client/src/list.tsx'],
      });
    }
  });

  it('CONV-002: any is never allowed', async () => {
    await expectRule('@typescript-eslint/no-explicit-any', 'export const a: any = 1;\n', {
      reports: [serverFile, coreTest],
      quiet: [],
    });
  });

  it('CONV-003: non-null assertions are allowed only in tests', async () => {
    const code = 'const a: string | undefined = undefined;\nexport const b = a!;\n';
    await expectRule('@typescript-eslint/no-non-null-assertion', code, {
      reports: [serverFile, coreFile],
      quiet: [coreTest],
    });
  });

  it('CONV-004: enums are never allowed', async () => {
    await expectRule('no-restricted-syntax', 'export enum Color {\n  Red,\n}\n', {
      reports: [serverFile, coreFile, 'apps/client/src/app.tsx'],
      quiet: [],
    });
  });

  it('CONV-005: default exports are allowed only in tool config files', async () => {
    await expectRule('no-restricted-syntax', 'export default 1;\n', {
      reports: [serverFile, coreFile, 'apps/client/src/app.tsx'],
      quiet: ['apps/client/vite.config.ts', 'vitest.config.ts'],
    });
  });
});

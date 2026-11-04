import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AppError,
  type MachineConfig,
  type Result,
  SECRET_PLACEHOLDER,
  type SemanticIssue,
  SemanticIssueSchema,
} from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ConfigFs, MACHINE_CONFIG_FILE, openConfig } from './machine-config';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function emptyDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mythos-config-'));
  tempDirs.push(dir);
  return dir;
}

function open(dir: string, fs?: ConfigFs) {
  return openConfig({
    dataDirFlag: dir,
    platform: process.platform,
    env: {},
    homedir: dir,
    cwd: dir,
    ...(fs === undefined ? {} : { fs }),
  });
}

function loaded(state: Awaited<ReturnType<typeof open>>['store']): MachineConfig {
  const current = state.current();
  if (!current.ok) throw new Error(`config did not load: ${current.error.message}`);
  return current.value;
}

const IssuesSchema = z.object({ issues: z.array(SemanticIssueSchema) });

/** The issues of a `validation_failed` result (CON-091), parsed rather than assumed. */
function issuesOf<T>(result: Result<T, AppError>): SemanticIssue[] {
  if (result.ok) return [];
  expect(result.error.code).toBe('validation_failed');
  return IssuesSchema.parse(result.error.details).issues;
}

const textProfile = {
  id: 'qwen-local',
  providerId: 'ollama-local',
  model: 'qwen3.6:35b-a3b',
  kind: 'text',
  contextWindow: 32768,
  maxOutputTokens: 2048,
  structuredOutput: 'json-schema',
};

describe('openConfig', () => {
  it('PRV-001: an empty folder gets the default config, which loads', async () => {
    const dir = emptyDir();
    const { store, created } = await open(dir);
    expect(created).toBe(true);
    const config = loaded(store);
    expect(config.devices).toEqual([
      { id: 'this-computer', name: 'This computer', concurrency: 1 },
    ]);
    expect(config.providers).toMatchObject([
      { type: 'ollama', baseUrl: 'http://localhost:11434', deviceId: 'this-computer' },
    ]);
    expect(config.modelProfiles).toEqual([]);
    expect(Object.values(config.roles).every((role) => role === null)).toBe(true);

    const again = await open(dir);
    expect(again.created).toBe(false);
    expect(loaded(again.store)).toEqual(config);
  });

  it('ARCH-030: with --data-dir, the config and the data both live in that folder', async () => {
    const dir = emptyDir();
    const { store } = await open(dir);
    expect(store.configPath).toBe(path.join(dir, MACHINE_CONFIG_FILE));
    expect(store.dataDir).toBe(dir);
  });

  it('PRV-002: a broken file keeps its issues, with paths, and is never replaced', async () => {
    const dir = emptyDir();
    const text = JSON.stringify({
      schemaVersion: 1,
      devices: [{ id: 'gpu', name: 'GPU' }],
      providers: [{ id: 'local', type: 'ollama', baseUrl: 'not a url', deviceId: 'gpu' }],
      modelProfiles: [{ ...textProfile, providerId: 'local', contextWindow: -1 }],
    });
    writeFileSync(path.join(dir, MACHINE_CONFIG_FILE), text);
    const { store, created } = await open(dir);
    expect(created).toBe(false);
    expect(issuesOf(store.current()).map((issue) => issue.path)).toEqual([
      'providers.0.baseUrl',
      'modelProfiles.0.contextWindow',
    ]);
    expect(readFileSync(path.join(dir, MACHINE_CONFIG_FILE), 'utf8')).toBe(text);
  });

  it('PRV-002: a file that is not JSON is one issue at the root', async () => {
    const dir = emptyDir();
    writeFileSync(path.join(dir, MACHINE_CONFIG_FILE), '{ "schemaVersion": 1,');
    const issues = issuesOf((await open(dir)).store.current());
    expect(issues.map((issue) => issue.path)).toEqual(['']);
    expect(issues[0]?.message).toContain('not valid JSON');
  });
});

describe('ConfigStore.save', () => {
  it('PRV-003: a save is validated first, and an invalid one writes nothing', async () => {
    const dir = emptyDir();
    const { store } = await open(dir);
    const before = readFileSync(store.configPath, 'utf8');
    const result = await store.save({
      ...loaded(store),
      roles: { narrator: { profileId: 'ghost' } },
    });
    expect(issuesOf(result).map((issue) => issue.path)).toEqual(['roles.narrator.profileId']);
    expect(readFileSync(store.configPath, 'utf8')).toBe(before);
  });

  it('PRV-003: a crash between the temp write and the rename leaves the old file intact', async () => {
    const dir = emptyDir();
    const crashAtRename: ConfigFs = {
      writeFile: (file, text) => writeFile(file, text, 'utf8'),
      rename: () => Promise.reject(new Error('simulated crash')),
      rm,
    };
    const { store } = await open(dir);
    const before = readFileSync(store.configPath, 'utf8');
    const crashing = await open(dir, crashAtRename);
    await expect(
      crashing.store.save({ ...loaded(store), queue: { maxAttempts: 5 } }),
    ).rejects.toThrow('simulated crash');
    expect(readFileSync(store.configPath, 'utf8')).toBe(before);
    expect(readdirSync(dir)).toEqual([MACHINE_CONFIG_FILE]);
  });

  it('PRV-004: saved roles and profiles apply at once, with no restart', async () => {
    const { store } = await open(emptyDir());
    const result = await store.save({
      ...loaded(store),
      modelProfiles: [textProfile],
      roles: { narrator: { profileId: 'qwen-local' } },
    });
    expect(result).toMatchObject({ ok: true, value: { restartRequired: false } });
    expect(loaded(store).roles.narrator).toEqual({ profileId: 'qwen-local' });
  });

  it('PRV-004: server and dataDir changes need a restart; the PIN does not', async () => {
    const { store } = await open(emptyDir());
    const base = loaded(store);
    const restart = async (change: Partial<MachineConfig>) => {
      const result = await store.save({ ...base, ...change });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.restartRequired;
    };
    expect(await restart({ server: { ...base.server, port: 6000 } })).toBe(true);
    expect(await restart({ dataDir: 'elsewhere' })).toBe(true);
    expect(
      await restart({
        server: { ...base.server, pin: { hash: 'scrypt$h', localhostExempt: true } },
      }),
    ).toBe(false);
  });

  it('CON-111: a save returns secrets as placeholders, and sending them back keeps the key', async () => {
    const { store } = await open(emptyDir());
    const withKey = {
      ...loaded(store),
      devices: [...loaded(store).devices, { id: 'cloud', name: 'Cloud' }],
      providers: [
        ...loaded(store).providers,
        {
          id: 'anthropic',
          type: 'anthropic',
          deviceId: 'cloud',
          apiKey: { value: 'sk-ant-secret' },
        },
      ],
    };
    const first = await store.save(withKey);
    if (!first.ok) throw new Error(first.error.message);
    expect(JSON.stringify(first.value)).not.toContain('sk-ant-secret');
    expect(first.value.config.providers[1]).toMatchObject({
      apiKey: { value: SECRET_PLACEHOLDER },
    });

    const second = await store.save(first.value.config);
    expect(second.ok).toBe(true);
    expect(readFileSync(store.configPath, 'utf8')).toContain('sk-ant-secret');
  });

  it('ARCH-032: the module writes only machine-config.json, in its own folder', async () => {
    const dir = emptyDir();
    const { store } = await open(dir);
    await store.save({ ...loaded(store), queue: { maxAttempts: 4 } });
    expect(readdirSync(dir)).toEqual([MACHINE_CONFIG_FILE]);
  });
});

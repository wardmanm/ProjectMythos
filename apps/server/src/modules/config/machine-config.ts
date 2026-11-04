// Machine config: written as a default on first start (PRV-001), loaded and checked
// (PRV-002), and saved atomically from settings (PRV-003). The store holds the current
// config, so edits apply to the next model call without a restart (PRV-004).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  type AppError,
  type MachineConfig,
  MachineConfigSchema,
  type Result,
  type SaveSettingsResultSchema,
  type SemanticIssue,
  err,
  ok,
} from '@mythos/contracts';
import type { z } from 'zod';
import { checkCrossReferences } from './cross-references';
import { type DataDirEnv, defaultDataDir, resolveConfigDir, resolveDataDir } from './data-dir';
import { mergeSecrets, redact } from './secrets';

export const MACHINE_CONFIG_FILE = 'machine-config.json';

type SaveSettingsResult = z.infer<typeof SaveSettingsResultSchema>;

/** The loaded config, or the `validation_failed` error that stopped it loading. */
export type ConfigState = Result<MachineConfig, AppError>;

/** The live machine config. Built once by the composition root (ARCH-022). */
export type ConfigStore = {
  /** The file the config is read from and saved to. */
  readonly configPath: string;
  /** Where campaigns, packs, the library, and logs live. Fixed until restart (PRV-004). */
  readonly dataDir: string;
  /** The config now in effect, or why it failed to load. */
  current(): ConfigState;
  /** Validates an edit from settings and saves it atomically; see `save` below. */
  save(incoming: unknown): Promise<Result<SaveSettingsResult, AppError>>;
};

/** The file operations the store uses; a test swaps in a rename that fails. */
export type ConfigFs = {
  writeFile: (file: string, text: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rm: (file: string, options: { force: boolean }) => Promise<void>;
};

const nodeFs: ConfigFs = {
  writeFile: (file, text) => writeFile(file, text, 'utf8'),
  rename,
  rm,
};

export type OpenConfigOptions = {
  /** The `--data-dir` command-line flag, or null. */
  dataDirFlag: string | null;
  platform: NodeJS.Platform;
  env: DataDirEnv;
  homedir: string;
  cwd: string;
  fs?: ConfigFs;
};

/**
 * The config written on first start: one device, one Ollama provider on localhost, no
 * model profiles, and every role unassigned. The schema's defaults fill in the rest.
 * Implements PRV-001.
 */
export function defaultMachineConfigFile(): z.input<typeof MachineConfigSchema> {
  return {
    schemaVersion: 1,
    devices: [{ id: 'this-computer', name: 'This computer' }],
    providers: [
      {
        id: 'ollama-local',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        deviceId: 'this-computer',
      },
    ],
    modelProfiles: [],
    roles: {
      adjudicator: null,
      narrator: null,
      'npc-voice': null,
      extractor: null,
      consolidator: null,
      'world-ticker': null,
      embedder: null,
      illustrator: null,
      'speech-segmenter': null,
    },
  };
}

/**
 * Checks parsed JSON against the schema, then its cross-references, and returns every
 * issue at a dotted path (CON-091). Implements PRV-002.
 */
export function parseMachineConfig(json: unknown): Result<MachineConfig, SemanticIssue[]> {
  const parsed = MachineConfigSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  const issues = checkCrossReferences(parsed.data);
  return issues.length > 0 ? err(issues) : ok(parsed.data);
}

function parseConfigText(text: string): Result<MachineConfig, SemanticIssue[]> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    // Not JSON at all: one issue for the whole file, rather than a crash.
    const reason = error instanceof Error ? error.message : String(error);
    return err([{ path: '', message: `${MACHINE_CONFIG_FILE} is not valid JSON: ${reason}` }]);
  }
  return parseMachineConfig(json);
}

function validationFailed(issues: SemanticIssue[]): AppError {
  return {
    code: 'validation_failed',
    message: `${MACHINE_CONFIG_FILE} has problems. Fix them in Settings or in the file.`,
    details: { issues },
  };
}

/**
 * Replaces `file` without ever leaving it half written: the text goes to a temp file
 * beside it, which is then renamed over it. Implements PRV-003 (and the CONV-085
 * exception: the temp file sits beside its target so the rename stays on one volume).
 */
export async function writeFileAtomic(file: string, text: string, fs: ConfigFs): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, text);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

function toFileText(config: unknown): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

// A change to `server` (but not the PIN, which applies at once) or to `dataDir` only
// takes effect after a restart, so compare with what the server started with (PRV-004).
function needsRestart(running: MachineConfig | null, saved: MachineConfig): boolean {
  if (running === null) return true;
  const serverWithoutPin = (config: MachineConfig) => ({ ...config.server, pin: null });
  return (
    !isDeepStrictEqual(serverWithoutPin(running), serverWithoutPin(saved)) ||
    running.dataDir !== saved.dataDir
  );
}

/**
 * Opens machine config: finds its folder (the `--data-dir` flag, else the OS default),
 * writes the default there if there is none, and loads it. A file that fails to load is
 * never replaced; its issues are in `current()`. `created` says whether the default was
 * written, for the caller to log.
 */
export async function openConfig(
  options: OpenConfigOptions,
): Promise<{ store: ConfigStore; created: boolean }> {
  const fs = options.fs ?? nodeFs;
  const osDefault = defaultDataDir(options.platform, options.env, options.homedir);
  const configDir = resolveConfigDir({ flag: options.dataDirFlag, cwd: options.cwd, osDefault });
  const configPath = path.join(configDir, MACHINE_CONFIG_FILE);

  await mkdir(configDir, { recursive: true });
  const created = !(await fileExists(configPath));
  if (created) await writeFileAtomic(configPath, toFileText(defaultMachineConfigFile()), fs);

  const loaded = parseConfigText(await readFile(configPath, 'utf8'));
  let state: ConfigState = loaded.ok ? loaded : err(validationFailed(loaded.error));
  const running = state.ok ? state.value : null;
  const dataDir = resolveDataDir({
    flag: options.dataDirFlag,
    configured: running?.dataDir ?? null,
    configDir,
    cwd: options.cwd,
    osDefault,
  });

  // Merges stored secrets, validates, writes, then makes the result current. A save that
  // fails validation changes nothing. Returns the saved config with secrets replaced.
  async function save(incoming: unknown): Promise<Result<SaveSettingsResult, AppError>> {
    const merged = mergeSecrets(incoming, state.ok ? state.value : null);
    const parsed = parseMachineConfig(merged.config);
    const issues = [...merged.issues, ...(parsed.ok ? [] : parsed.error)];
    if (!parsed.ok || issues.length > 0) return err(validationFailed(issues));

    await writeFileAtomic(configPath, toFileText(parsed.value), fs);
    state = ok(parsed.value);
    return ok({
      config: redact(parsed.value),
      restartRequired: needsRestart(running, parsed.value),
    });
  }

  return { store: { configPath, dataDir, current: () => state, save }, created };
}

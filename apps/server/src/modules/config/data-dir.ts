// Where Mythos keeps its data on each OS, and which folder wins when the command line,
// machine config, and the OS default disagree (ARCH-030).
import path from 'node:path';

/** The environment variables the OS default reads. */
export type DataDirEnv = Readonly<Record<string, string | undefined>>;

function nonEmpty(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}

/**
 * The OS default data directory. Pure, so tests cover every OS on any machine.
 * Implements ARCH-030.
 */
export function defaultDataDir(
  platform: NodeJS.Platform,
  env: DataDirEnv,
  homedir: string,
): string {
  // path.win32 and path.posix, not path, so the result is right for `platform` even when
  // computed on another OS.
  if (platform === 'win32') {
    const appData = nonEmpty(env.APPDATA) ?? path.win32.join(homedir, 'AppData', 'Roaming');
    return path.win32.join(appData, 'Mythos');
  }
  if (platform === 'darwin') {
    return path.posix.join(homedir, 'Library', 'Application Support', 'Mythos');
  }
  // Linux and anything else, for development containers: the XDG data directory.
  const dataHome = nonEmpty(env.XDG_DATA_HOME) ?? path.posix.join(homedir, '.local', 'share');
  return path.posix.join(dataHome, 'mythos');
}

/** The folder that holds `machine-config.json`: the `--data-dir` flag, else the OS default. */
export function resolveConfigDir(options: {
  flag: string | null;
  cwd: string;
  osDefault: string;
}): string {
  return options.flag === null ? options.osDefault : path.resolve(options.cwd, options.flag);
}

/**
 * The data directory everything else lives in: the `--data-dir` flag, then machine
 * config's `dataDir`, then the OS default. A relative `dataDir` is read from the folder
 * holding the config. Implements ARCH-030.
 */
export function resolveDataDir(options: {
  flag: string | null;
  configured: string | null;
  configDir: string;
  cwd: string;
  osDefault: string;
}): string {
  if (options.flag !== null) return path.resolve(options.cwd, options.flag);
  if (options.configured !== null) return path.resolve(options.configDir, options.configured);
  return options.osDefault;
}

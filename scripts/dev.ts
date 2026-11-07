// `pnpm dev` (ARCH-006): the server under `tsx watch` and the client under Vite's dev
// server, whose `/api` proxy reaches the server. It runs each package's own `dev` script
// through pnpm, with no shell (CONV-081), and imports no app code (ARCH-007). Arguments
// go to the server: `pnpm dev --data-dir <folder>`. When either process exits, the other
// is stopped.
import { type ChildProcess, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export type Command = { command: string; args: string[] };

/**
 * How to run the pnpm that started this script, from `npm_execpath`: Node with pnpm's
 * script, or pnpm's own binary (Corepack can give either).
 */
export function pnpmCommand(nodePath: string, npmExecPath: string | undefined): Command {
  if (npmExecPath === undefined || npmExecPath === '') {
    throw new Error('Start this with pnpm: pnpm dev');
  }
  return /\.[cm]?js$/.test(npmExecPath)
    ? { command: nodePath, args: [npmExecPath] }
    : { command: npmExecPath, args: [] };
}

/**
 * The server's `dev` script (`tsx watch`), given `serverArgs`, and the client's (`vite`).
 * Implements ARCH-006.
 */
export function devCommands(
  pnpm: Command,
  serverArgs: readonly string[],
): { server: Command; client: Command } {
  const runDev = (packageName: string, extra: readonly string[]): Command => ({
    command: pnpm.command,
    args: [...pnpm.args, '--filter', packageName, 'run', 'dev', ...extra],
  });
  return { server: runDev('@mythos/server', serverArgs), client: runDev('@mythos/client', []) };
}

function main(): void {
  const pnpm = pnpmCommand(process.execPath, process.env['npm_execpath']);
  const { server, client } = devCommands(pnpm, process.argv.slice(2));
  const children: ChildProcess[] = [server, client].map(({ command, args }) =>
    spawn(command, args, { stdio: 'inherit' }),
  );

  // Signals each child once. A second signal makes `tsx watch` kill the server before it
  // has committed a narration it was stopping (06-turn-engine Decisions).
  let stopping = false;
  const stopAll = (signal: NodeJS.Signals | null) => {
    if (stopping) return;
    stopping = true;
    if (signal === null) return;
    for (const child of children) if (child.exitCode === null) child.kill(signal);
  };
  for (const child of children) {
    child.on('exit', (code) => {
      if (process.exitCode === undefined) process.exitCode = code ?? 1;
      // One process ended by itself, as a crash does: stop the other too.
      stopAll('SIGTERM');
    });
  }
  // Ctrl+C reaches every child from the terminal already, so this process only waits.
  process.on('SIGINT', () => {
    stopAll(null);
  });
  process.on('SIGTERM', () => {
    stopAll('SIGTERM');
  });
}

// Run as a script, not when a test imports it.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) main();

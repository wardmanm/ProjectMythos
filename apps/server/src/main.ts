// The server's entry point, run with `tsx` (ADR-015):
//   tsx src/main.ts [--data-dir <folder>] [--port <number>]
// It builds the server in the composition root (ARCH-022), listens, and shuts down
// cleanly on SIGINT or SIGTERM. A second signal exits at once.
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { createServer } from './app';

const USAGE = 'Usage: pnpm start [--data-dir <folder>] [--port <number>]';

type Flags = { dataDir: string | null; port: number | null };

/** The command-line flags, or what is wrong with them. */
function parseFlags(args: string[]): Flags | string {
  let values: { 'data-dir'?: string | undefined; port?: string | undefined };
  try {
    ({ values } = parseArgs({
      // pnpm passes a leading `--` through to the script.
      args: args[0] === '--' ? args.slice(1) : args,
      options: { 'data-dir': { type: 'string' }, port: { type: 'string' } },
    }));
  } catch (error) {
    // parseArgs throws for an unknown flag or a missing value: the message says which.
    return error instanceof Error ? error.message : String(error);
  }
  const port = values.port === undefined ? null : Number(values.port);
  if (port !== null && !(Number.isInteger(port) && port >= 1 && port <= 65535)) {
    return `--port must be a whole number from 1 to 65535, not ${values.port ?? ''}.`;
  }
  return { dataDir: values['data-dir'] ?? null, port };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (typeof flags === 'string') {
    process.stderr.write(`${flags}\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  const server = await createServer({
    dataDirFlag: flags.dataDir,
    portFlag: flags.port,
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    cwd: process.cwd(),
  });
  const log = server.fastify.log;

  let stopping = false;
  const shutDown = (signal: NodeJS.Signals): void => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info({ signal }, 'shutting down');
    server.close().then(
      () => {
        log.info({}, 'stopped');
      },
      (error: unknown) => {
        log.error({ err: error }, 'shutdown failed');
        process.exitCode = 1;
      },
    );
  };
  process.on('SIGINT', shutDown);
  process.on('SIGTERM', shutDown);

  try {
    await server.listen();
  } catch (error) {
    // Usually the port is in use; the error says which.
    log.error({ err: error }, 'Mythos could not start listening');
    process.exitCode = 1;
    await server.close();
  }
}

await main();

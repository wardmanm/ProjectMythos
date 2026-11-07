import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { devCommands, pnpmCommand } from './dev';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/** A package.json, left unknown: the tests match only the scripts they name. */
function packageOf(...segments: string[]): unknown {
  const file = path.join(repositoryRoot, ...segments, 'package.json');
  const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return json;
}

describe('pnpmCommand', () => {
  it('ARCH-006: a pnpm script is run with Node, and a pnpm binary on its own, with no shell', () => {
    expect(pnpmCommand('/bin/node', '/pnpm/bin/pnpm.cjs')).toEqual({
      command: '/bin/node',
      args: ['/pnpm/bin/pnpm.cjs'],
    });
    expect(pnpmCommand('/bin/node', '/pnpm/pnpm-native')).toEqual({
      command: '/pnpm/pnpm-native',
      args: [],
    });
    expect(() => pnpmCommand('/bin/node', undefined)).toThrow('pnpm dev');
  });
});

describe('devCommands', () => {
  it('ARCH-006: pnpm dev runs both packages’ dev scripts, with its arguments for the server', () => {
    const pnpm = { command: 'pnpm', args: [] };
    expect(devCommands(pnpm, ['--port', '6000'])).toEqual({
      server: {
        command: 'pnpm',
        args: ['--filter', '@mythos/server', 'run', 'dev', '--port', '6000'],
      },
      client: { command: 'pnpm', args: ['--filter', '@mythos/client', 'run', 'dev'] },
    });
  });

  it('ARCH-006: the scripts are tsx watch for the server, Vite for the client, and tsx to start', () => {
    expect(packageOf('apps', 'server')).toMatchObject({
      scripts: { dev: 'tsx watch src/main.ts', start: 'tsx src/main.ts' },
    });
    expect(packageOf('apps', 'client')).toMatchObject({
      scripts: { dev: 'vite', build: 'vite build' },
    });
    expect(packageOf()).toMatchObject({
      scripts: {
        dev: 'tsx scripts/dev.ts',
        build: 'pnpm --filter @mythos/client build',
        start: 'pnpm --filter @mythos/server start',
      },
    });
  });
});

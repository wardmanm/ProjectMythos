import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ErrorResponseSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpSpace } from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

const INDEX = '<!doctype html><title>Mythos</title><div id="root"></div>';
const SCRIPT = 'console.log("mythos");';

/** A built client: `index.html` and one asset. */
function builtClient(): string {
  const dir = space.folder();
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), INDEX);
  writeFileSync(path.join(dir, 'assets', 'index-3f2a.js'), SCRIPT);
  return dir;
}

function messageOf(response: { json: () => unknown }): string {
  return ErrorResponseSchema.parse(response.json()).error.message;
}

describe('the built client', () => {
  it('ARCH-102: / and every client route get index.html, and assets are served as files', async () => {
    const stack = await space.stack({ clientDir: builtClient() });
    for (const url of ['/', '/new', '/settings', `/c/${randomUUID()}/inspector/${randomUUID()}`]) {
      const response = await stack.server.inject({ url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(response.body).toBe(INDEX);
    }
    const asset = await stack.server.inject({ url: '/assets/index-3f2a.js' });
    expect(asset.headers['content-type']).toMatch(/javascript/);
    expect(asset.body).toBe(SCRIPT);
  });

  it('ARCH-102, CON-110: a missing file, an unknown /api route, or a POST is not_found, never HTML', async () => {
    const stack = await space.stack({ clientDir: builtClient() });
    for (const [method, url] of [
      ['GET', '/assets/missing.js'],
      ['GET', '/api/nope'],
      ['POST', '/new'],
    ] as const) {
      const response = await stack.server.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('not_found');
    }
  });

  it('CON-113: the client is served without a session, even with a PIN set', async () => {
    const stack = await space.stack({ clientDir: builtClient() });
    await stack.auth.setPin({ pin: '2468', localhostExempt: false });
    for (const url of ['/', `/c/${randomUUID()}`, '/assets/index-3f2a.js']) {
      const response = await stack.server.inject({ url, remoteAddress: '192.168.1.20' });
      expect(response.statusCode, url).toBe(200);
    }
  });

  it('ARCH-102: with no built client, pages say to build it and the API still answers', async () => {
    const stack = await space.stack({ clientDir: space.folder() });
    const page = await stack.server.inject({ url: '/' });
    expect(page.statusCode).toBe(404);
    expect(messageOf(page)).toContain('pnpm build');
    const api = await stack.server.inject({ url: '/api/nope' });
    expect(messageOf(api)).toBe('Nothing is at /api/nope.');
    const packs = await stack.server.inject({ url: '/api/packs' });
    expect(packs.statusCode).toBe(200);
    expect(stack.logs().map((line) => line.msg)).toContain(
      'the client is not built, so only the API is served',
    );
  });
});

import { PackSummarySchema } from '@mythos/contracts';
import { ThemeSchema } from '@mythos/contracts/content';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpSpace } from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

describe('library routes', () => {
  it('ARCH-023: GET /packs lists the packs as the content module reads them', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({ url: '/api/packs' });
    expect(response.statusCode).toBe(200);
    const packs = z.array(PackSummarySchema).parse(response.json());
    expect(packs.map((pack) => pack.packId)).toContain('reference');
  });

  it('ARCH-023: GET /themes lists every theme a campaign can wear', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({ url: '/api/themes' });
    expect(response.statusCode).toBe(200);
    const themes = z.array(ThemeSchema).parse(response.json());
    expect(themes.map((theme) => theme.id)).toContain('theme.house');
  });
});

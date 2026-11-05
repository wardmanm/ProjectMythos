import { CampaignViewSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { campaignId, campaignView } from '@/test/fixtures';
import { apiFailureOf, type ApiFailure } from './api-failure';
import { request, requestNoContent } from './client';

const path = `/campaigns/${campaignId}`;
const url = `/api${path}`;

/** The failure a request throws; fails the test if it succeeds or throws something else. */
async function failureOf(attempt: Promise<unknown>): Promise<ApiFailure> {
  const thrown: unknown = await attempt.then(
    () => new Error('the request succeeded'),
    (error: unknown) => error,
  );
  const failure = apiFailureOf(thrown);
  if (failure === null) throw new Error(`not an API failure: ${String(thrown)}`);
  return failure;
}

describe('request', () => {
  it('ARCH-122: a success body is parsed with its contract schema', async () => {
    answer('GET', url, { status: 200, body: campaignView() });
    const view = await request(path, CampaignViewSchema);
    expect(view.name).toBe('Brinemoor: Arrival');
    expect(view.theme.id).toBe('theme.house');
  });

  it('ARCH-122: the request goes to a relative /api address, with a JSON body', async () => {
    answer('POST', '/api/campaigns', { status: 200, body: campaignView() });
    await request('/campaigns', CampaignViewSchema, { method: 'POST', body: { name: 'Wren' } });
    expect(fetchCalls()).toEqual([
      { method: 'POST', url: '/api/campaigns', body: { name: 'Wren' } },
    ]);
  });

  it('ARCH-122: an error body becomes a typed failure with its code and status', async () => {
    answer('GET', url, {
      status: 503,
      body: { error: { code: 'provider_unavailable', message: 'Ollama is not running' } },
    });
    expect(await failureOf(request(path, CampaignViewSchema))).toEqual({
      kind: 'server',
      status: 503,
      error: { code: 'provider_unavailable', message: 'Ollama is not running' },
    });
  });

  it("ARCH-122: an error answer that isn't the server's error body means the server was not reached", async () => {
    answer('GET', url, { status: 502, text: '<html>Bad gateway</html>' });
    expect((await failureOf(request(path, CampaignViewSchema))).kind).toBe('unreachable');
    answer('GET', url, { status: 500, body: { message: 'not ours' } });
    expect((await failureOf(request(path, CampaignViewSchema))).kind).toBe('unreachable');
  });

  it('ARCH-122: a request that gets no answer at all is unreachable', async () => {
    answer('GET', url, { unreachable: true });
    expect((await failureOf(request(path, CampaignViewSchema))).kind).toBe('unreachable');
  });

  it('ARCH-122: a success body that fails its schema is an invalid response', async () => {
    answer('GET', url, { status: 200, body: { ...campaignView(), currentBranchId: 'main' } });
    const failure = await failureOf(request(path, CampaignViewSchema));
    expect(failure.kind).toBe('invalid-response');
    expect(failure.kind === 'invalid-response' && failure.detail).toContain('currentBranchId');
    answer('GET', url, { status: 200, text: 'not json' });
    expect((await failureOf(request(path, CampaignViewSchema))).kind).toBe('invalid-response');
  });
});

describe('requestNoContent', () => {
  it('ARCH-122: a 204 resolves, and an error body still becomes a typed failure', async () => {
    answer('DELETE', url, { status: 204 });
    await expect(requestNoContent(path, { method: 'DELETE' })).resolves.toBeUndefined();
    answer('DELETE', url, { status: 404, body: { error: { code: 'not_found', message: 'gone' } } });
    const failure = await failureOf(requestNoContent(path, { method: 'DELETE' }));
    expect(failure.kind === 'server' && failure.error.code).toBe('not_found');
  });
});

import { randomUUID } from 'node:crypto';
import { ErrorResponseSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { KEEP_ALIVE_INTERVAL_MS } from '../events';
import { MAX_UNSENT_BYTES } from './events';
import {
  createArrival,
  createHttpSpace,
  frameReader,
  type HttpStack,
  settledTurn,
} from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

/** A campaign whose opening has settled, so its events are all in the bus. */
async function quietCampaign(stack: HttpStack): Promise<string> {
  const view = await createArrival(stack);
  await settledTurn(stack, view.campaignId, view.headTurnId);
  return view.campaignId;
}

async function openStream(stack: HttpStack, campaignId: string, lastEventId?: string) {
  const response = await stack.server.inject({
    url: `/api/campaigns/${campaignId}/events`,
    headers: lastEventId === undefined ? {} : { 'last-event-id': lastEventId },
    payloadAsStream: true,
  });
  return { response, reader: frameReader(response.stream()) };
}

function publishStatus(stack: HttpStack, campaignId: string) {
  return stack.bus.publish(campaignId, {
    type: 'turn.status',
    turnId: randomUUID(),
    status: 'complete',
  });
}

/** Lets the stream's piping run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

/** The keep-alive timers waiting now. */
const keepAlives = (stack: HttpStack) =>
  [...stack.timers].filter((timer) => timer.ms === KEEP_ALIVE_INTERVAL_MS);

describe('GET /campaigns/:campaignId/events', () => {
  it('ARCH-091: a new stream is text/event-stream and starts at the bus position, with no event', async () => {
    const stack = await space.stack();
    const campaignId = await quietCampaign(stack);
    const { response, reader } = await openStream(stack, campaignId);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    await flush();
    expect(reader.frames[0]).toEqual({
      id: String(stack.bus.lastId()),
      event: null,
      data: null,
      comment: null,
    });
  });

  it('ARCH-090: each event arrives as one frame named by its type, holding the whole event', async () => {
    const stack = await space.stack();
    const campaignId = await quietCampaign(stack);
    const { reader } = await openStream(stack, campaignId);
    const published = publishStatus(stack, campaignId);
    expect(await reader.waitFor((event) => event.id === published.id)).toEqual(published);
    expect(reader.frames.at(-1)).toMatchObject({ id: String(published.id), event: 'turn.status' });
  });

  it('ARCH-091: with a covered Last-Event-ID the missed events are replayed in order', async () => {
    const stack = await space.stack();
    const campaignId = await quietCampaign(stack);
    const first = publishStatus(stack, campaignId);
    const second = publishStatus(stack, campaignId);
    const third = publishStatus(stack, campaignId);
    const { reader } = await openStream(stack, campaignId, String(first.id));
    await reader.waitFor((event) => event.id === third.id);
    expect(reader.events().map((event) => event.id)).toEqual([second.id, third.id]);
  });

  it('ARCH-091: an ID the buffer does not cover gets resync.required', async () => {
    const stack = await space.stack();
    const campaignId = await quietCampaign(stack);
    const { reader } = await openStream(stack, campaignId, String(stack.bus.lastId() + 50));
    const resync = await reader.waitFor((event) => event.payload.type === 'resync.required');
    expect(resync.campaignId).toBe(campaignId);
  });

  it('CON-114: the keep-alive comment is sent after 15 seconds with nothing else sent', async () => {
    const stack = await space.stack();
    const campaignId = await quietCampaign(stack);
    const { reader } = await openStream(stack, campaignId, String(stack.bus.lastId()));
    await flush();
    // Nothing to replay, so the keep-alive went at once and the headers with it.
    expect(reader.frames.map((frame) => frame.comment)).toEqual(['keep-alive']);
    const [timer] = keepAlives(stack);
    timer?.fire();
    await flush();
    expect(reader.frames.map((frame) => frame.comment)).toEqual(['keep-alive', 'keep-alive']);
    // Each write starts the 15 seconds again, so one timer waits at a time.
    publishStatus(stack, campaignId);
    expect(keepAlives(stack)).toHaveLength(1);
  });

  it('ARCH-090: closing the connection unsubscribes the stream and stops its keep-alive', async () => {
    const stack = await space.stack();
    const campaignId = await quietCampaign(stack);
    const { response, reader } = await openStream(stack, campaignId);
    await flush();
    response.raw.res.destroy();
    await flush();
    expect(keepAlives(stack)).toEqual([]);
    const framesBefore = reader.frames.length;
    publishStatus(stack, campaignId);
    await flush();
    expect(reader.frames).toHaveLength(framesBefore);
  });

  it('ARCH-090: a stream whose client falls 1 MiB behind is closed', async () => {
    const stack = await space.stack();
    const campaignId = await quietCampaign(stack);
    const response = await stack.server.inject({
      url: `/api/campaigns/${campaignId}/events`,
      payloadAsStream: true,
    });
    // Nothing reads the stream, so its frames pile up unsent.
    const text = 'x'.repeat(2000);
    for (let offset = 0; offset * text.length < MAX_UNSENT_BYTES * 1.2; offset += 1) {
      stack.bus.publish(campaignId, {
        type: 'narration.delta',
        turnId: randomUUID(),
        offset: offset * text.length,
        text,
      });
    }
    expect(keepAlives(stack)).toEqual([]);
    const reader = frameReader(response.stream());
    await new Promise((resolve) => response.stream().on('end', resolve));
    expect(reader.ended()).toBe(true);
    expect(stack.logs().map((line) => line.msg)).toContain(
      'an event stream fell too far behind, so it was closed',
    );
  });

  it('ARCH-104: an unknown campaign is not_found', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({ url: `/api/campaigns/${randomUUID()}/events` });
    expect(response.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('not_found');
  });

  it('ARCH-090: shutting the server down ends every open stream', async () => {
    const stack = await space.stack();
    const campaignId = await quietCampaign(stack);
    const { reader } = await openStream(stack, campaignId);
    await flush();
    await stack.server.close();
    await flush();
    expect(reader.ended()).toBe(true);
  });
});

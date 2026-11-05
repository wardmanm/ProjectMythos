import { ServerEventPayloadSchema, type ServerEventPayload } from '@mythos/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FakeEventSource, latestEventSource } from '@/test/fake-event-source';
import { campaignId, otherCampaignId, serverEvent, turnId } from '@/test/fixtures';
import { openCampaignEvents, reopenDelays } from './campaign-events';

/** Opens the stream, recording what it delivers. */
function open() {
  const payloads: ServerEventPayload[] = [];
  const onReopened = vi.fn();
  const close = openCampaignEvents({
    campaignId,
    onPayload: (payload) => payloads.push(payload),
    onReopened,
  });
  return { payloads, onReopened, close, source: latestEventSource() };
}

const status = (id: number) =>
  serverEvent({ type: 'turn.status', turnId, status: 'narrating' }, id);

describe('openCampaignEvents', () => {
  it("UI-101: one stream per campaign, at the campaign's events address", () => {
    const { source } = open();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.url).toBe(`/api/campaigns/${campaignId}/events`);
  });

  it('UI-101: every payload type is delivered, each under its own frame name', () => {
    const { payloads, source } = open();
    source.open();
    const types = ServerEventPayloadSchema.options.map((option) => option.shape.type.value);
    let id = 1;
    for (const type of types) {
      source.sendRaw(type, JSON.stringify(serverEvent({ type: 'resync.required' }, id++)));
    }
    expect(payloads).toHaveLength(types.length);
  });

  it('UI-132: events arrive in order, and a replayed one changes nothing', () => {
    const { payloads, source } = open();
    source.open();
    source.send(status(10));
    source.send(serverEvent({ type: 'narration.done', turnId }, 11));
    // The browser reconnects with Last-Event-ID 10, and the server replays 11.
    source.drop();
    source.open();
    source.send(serverEvent({ type: 'narration.done', turnId }, 11));
    source.send(serverEvent({ type: 'resync.required' }, 12));
    expect(payloads.map((payload) => payload.type)).toEqual([
      'turn.status',
      'narration.done',
      'resync.required',
    ]);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("UI-132: a frame that isn't a valid event, or is another campaign's, is treated as resync.required", () => {
    const { payloads, source } = open();
    source.open();
    source.sendRaw('turn.status', 'not json');
    source.sendRaw('turn.status', JSON.stringify({ id: 1, campaignId, payload: { type: 'nope' } }));
    source.sendRaw('turn.status', JSON.stringify({ ...status(2), campaignId: otherCampaignId }));
    expect(payloads).toEqual([
      { type: 'resync.required' },
      { type: 'resync.required' },
      { type: 'resync.required' },
    ]);
  });

  it("UI-101: the server's error payload is delivered, and is not taken for a connection error", () => {
    const { payloads, source } = open();
    source.open();
    const error = { code: 'provider_timeout' as const, message: 'timed out' };
    source.send(serverEvent({ type: 'error', turnId: null, error }, 5));
    expect(payloads).toEqual([{ type: 'error', turnId: null, error }]);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('UI-132: a stream the browser gave up on reopens after 1, 2, 5, 10, then 30 s, and refetches once open', () => {
    vi.useFakeTimers();
    const { onReopened, source } = open();
    source.open();
    let current = source;
    for (const seconds of [...reopenDelays, 30]) {
      current.fail();
      vi.advanceTimersByTime(seconds * 1000 - 1);
      expect(latestEventSource()).toBe(current);
      vi.advanceTimersByTime(1);
      expect(latestEventSource()).not.toBe(current);
      current = latestEventSource();
    }
    expect(onReopened).not.toHaveBeenCalled();
    current.open();
    expect(onReopened).toHaveBeenCalledTimes(1);
    // Once a reopened stream is open, the next failure waits 1 s again.
    current.fail();
    vi.advanceTimersByTime(1000);
    expect(latestEventSource()).not.toBe(current);
  });

  it('UI-132: after reopening, the fresh stream starts counting event IDs again', () => {
    vi.useFakeTimers();
    const { payloads, source } = open();
    source.open();
    source.send(status(50));
    source.fail();
    vi.advanceTimersByTime(1000);
    const fresh = latestEventSource();
    fresh.open();
    // A server restarted with a lower first ID still gets through.
    fresh.send(status(7));
    expect(payloads).toHaveLength(2);
  });

  it('UI-101: closing the stream ends it for good, with no reopening', () => {
    vi.useFakeTimers();
    const { close, source } = open();
    source.open();
    source.fail();
    close();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });
});

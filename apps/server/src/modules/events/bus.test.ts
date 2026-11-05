import type { ServerEvent, ServerEventPayload } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { REPLAY_BUFFER_SIZE, createEventBus } from './bus';
import { formatPosition, parseLastEventId } from './sse';

const campaignA = '11111111-1111-4111-8111-111111111111';
const campaignB = '22222222-2222-4222-8222-222222222222';
const turnId = '33333333-3333-4333-8333-333333333333';
const commitSetId = '44444444-4444-4444-8444-444444444444';

const firstId = 1_000;

function narrationDone(): ServerEventPayload {
  return { type: 'narration.done', turnId };
}

/** A subscriber's `send` and the events it received. */
function recorder(): { send: (event: ServerEvent) => void; received: ServerEvent[] } {
  const received: ServerEvent[] = [];
  return { send: (event) => received.push(event), received };
}

const idsOf = (events: ServerEvent[]) => events.map((event) => event.id);
const typesOf = (events: ServerEvent[]) => events.map((event) => event.payload.type);

describe('createEventBus', () => {
  it('ARCH-090: two campaigns never receive each other’s events, live or replayed', () => {
    const bus = createEventBus({ firstId });
    const liveA = recorder();
    const liveB = recorder();
    bus.subscribe(campaignA, null, liveA.send);
    bus.subscribe(campaignB, null, liveB.send);

    const a1 = bus.publish(campaignA, narrationDone());
    const b1 = bus.publish(campaignB, narrationDone());
    const a2 = bus.publish(campaignA, narrationDone());

    expect(liveA.received).toEqual([a1, a2]);
    expect(liveB.received).toEqual([b1]);

    const replayB = recorder();
    bus.subscribe(campaignB, firstId - 1, replayB.send);
    expect(replayB.received).toEqual([b1]);
  });

  it('ARCH-090: an unsubscribed subscriber receives nothing more', () => {
    const bus = createEventBus({ firstId });
    const stream = recorder();
    const unsubscribe = bus.subscribe(campaignA, null, stream.send);
    bus.publish(campaignA, narrationDone());
    unsubscribe();
    bus.publish(campaignA, narrationDone());
    expect(idsOf(stream.received)).toEqual([1_000]);

    // A stream may close itself from inside `send`.
    const once = recorder();
    const stopOnce = bus.subscribe(campaignA, null, (event) => {
      once.send(event);
      stopOnce();
    });
    bus.publish(campaignA, narrationDone());
    bus.publish(campaignA, narrationDone());
    expect(idsOf(once.received)).toEqual([1_002]);
  });

  it('ARCH-091: IDs start at firstId and increase by one across campaigns', () => {
    const bus = createEventBus({ firstId });
    expect(bus.lastId()).toBe(999);
    const ids = [
      bus.publish(campaignA, narrationDone()).id,
      bus.publish(campaignB, narrationDone()).id,
      bus.publish(campaignA, narrationDone()).id,
    ];
    expect(ids).toEqual([1_000, 1_001, 1_002]);
    expect(bus.lastId()).toBe(1_002);

    expect(() => createEventBus({ firstId: 0 })).toThrow(RangeError);
    expect(() => createEventBus({ firstId: 1.5 })).toThrow(RangeError);
  });

  it('ARCH-091: a subscriber with no last event ID gets nothing old', () => {
    const bus = createEventBus({ firstId });
    bus.publish(campaignA, narrationDone());
    const stream = recorder();
    bus.subscribe(campaignA, null, stream.send);
    expect(stream.received).toEqual([]);
  });

  it('ARCH-091: a covered ID replays exactly the missed events in order, then live ones', () => {
    const bus = createEventBus({ firstId });
    // Campaign B's events in between make campaign A's IDs skip numbers.
    for (let i = 0; i < 3; i++) {
      bus.publish(campaignA, narrationDone());
      bus.publish(campaignB, narrationDone());
    }
    const stream = recorder();
    bus.subscribe(campaignA, 1_002, stream.send);
    expect(idsOf(stream.received)).toEqual([1_004]);

    bus.publish(campaignA, narrationDone());
    expect(idsOf(stream.received)).toEqual([1_004, 1_006]);
  });

  it('ARCH-091: an evicted gap gets resync.required, then live events', () => {
    const bus = createEventBus({ firstId });
    for (let i = 0; i <= REPLAY_BUFFER_SIZE; i++) bus.publish(campaignA, narrationDone());
    // 1,001 events: 1,000 was evicted, and 1,001 to 2,000 are buffered.

    // A client that saw the evicted event misses nothing, so it is still covered.
    const atEdge = recorder();
    bus.subscribe(campaignA, 1_000, atEdge.send);
    expect(atEdge.received).toHaveLength(REPLAY_BUFFER_SIZE);
    expect(atEdge.received[0]?.id).toBe(1_001);
    expect(typesOf(atEdge.received)).not.toContain('resync.required');

    const behind = recorder();
    bus.subscribe(campaignA, 999, behind.send);
    expect(behind.received).toEqual([
      { id: 2_001, campaignId: campaignA, payload: { type: 'resync.required' } },
    ]);
    bus.publish(campaignA, narrationDone());
    expect(idsOf(behind.received)).toEqual([2_001, 2_002]);
  });

  it('ARCH-091: an ID from before a restart, or newer than any issued, gets resync.required', () => {
    const before = createEventBus({ firstId });
    const seen = before.publish(campaignA, narrationDone()).id;

    const restarted = createEventBus({ firstId: 5_000 });
    const afterRestart = recorder();
    restarted.subscribe(campaignA, seen, afterRestart.send);
    expect(typesOf(afterRestart.received)).toEqual(['resync.required']);

    const bus = createEventBus({ firstId });
    bus.publish(campaignA, narrationDone());
    const fromTheFuture = recorder();
    bus.subscribe(campaignA, 1_001, fromTheFuture.send);
    expect(fromTheFuture.received).toEqual([
      { id: 1_001, campaignId: campaignA, payload: { type: 'resync.required' } },
    ]);
  });

  it('ARCH-091: an unreadable Last-Event-ID is never covered', () => {
    for (const header of ['abc', '12.5', '-3', '1e3', '99999999999999999999', ['1000']]) {
      const bus = createEventBus({ firstId });
      bus.publish(campaignA, narrationDone());
      const stream = recorder();
      bus.subscribe(campaignA, parseLastEventId(header), stream.send);
      expect(typesOf(stream.received)).toEqual(['resync.required']);
    }
  });

  it('ARCH-091: a client that reconnects from the position it was given misses nothing', () => {
    const bus = createEventBus({ firstId });
    // A new stream starts with the current position, then drops before any event.
    expect(formatPosition(bus.lastId())).toBe('id: 999\n\n');
    const drop = bus.subscribe(campaignA, null, () => undefined);
    drop();

    bus.publish(campaignA, narrationDone());
    bus.publish(campaignA, narrationDone());
    const reconnected = recorder();
    bus.subscribe(campaignA, parseLastEventId('999'), reconnected.send);
    expect(idsOf(reconnected.received)).toEqual([1_000, 1_001]);

    // Once events exist, the position is the last ID issued, in any campaign.
    bus.publish(campaignB, narrationDone());
    expect(formatPosition(bus.lastId())).toBe('id: 1002\n\n');
    bus.publish(campaignA, narrationDone());
    const later = recorder();
    bus.subscribe(campaignA, parseLastEventId('1002'), later.send);
    expect(idsOf(later.received)).toEqual([1_003]);
  });

  it('ARCH-092: publish throws on a payload the contract rejects, and sends nothing', () => {
    const bus = createEventBus({ firstId });
    const stream = recorder();
    bus.subscribe(campaignA, null, stream.send);
    const unknownType = { type: 'turn.vanished', turnId } as unknown as ServerEventPayload;
    const missingField = { type: 'turn.created', turnId } as unknown as ServerEventPayload;

    expect(() => bus.publish(campaignA, unknownType)).toThrow(ZodError);
    expect(() => bus.publish(campaignA, missingField)).toThrow(ZodError);
    expect(() => bus.publish('campaign-a', narrationDone())).toThrow(ZodError);
    expect(stream.received).toEqual([]);
    expect(bus.publish(campaignA, narrationDone()).id).toBe(firstId);
  });

  it('CON-100: a state.changed reaches subscribers without the state it was given', () => {
    const bus = createEventBus({ firstId });
    const stream = recorder();
    bus.subscribe(campaignA, null, stream.send);
    const withState = {
      type: 'state.changed' as const,
      turnId,
      commitSetId,
      affectedEntityIds: ['npc.varek'],
      worldState: { entities: { 'npc.varek': { location: 'place.old-mill' } } },
    };
    bus.publish(campaignA, withState);
    expect(stream.received.map((event) => event.payload)).toEqual([
      { type: 'state.changed', turnId, commitSetId, affectedEntityIds: ['npc.varek'] },
    ]);
  });
});

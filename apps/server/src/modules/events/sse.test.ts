import { ServerEventSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { createEventBus } from './bus';
import {
  KEEP_ALIVE_COMMENT,
  KEEP_ALIVE_INTERVAL_MS,
  formatEvent,
  formatPosition,
  parseLastEventId,
} from './sse';

const campaignId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const turnId = '33333333-3333-4333-8333-333333333333';

describe('formatEvent', () => {
  it('ARCH-090: an event is one SSE frame: its ID, its payload type, and the event as JSON', () => {
    const bus = createEventBus({ firstId: 1_000 });
    const event = bus.publish(campaignId, { type: 'turn.created', branchId, turnId });
    expect(formatEvent(event)).toBe(
      'id: 1000\n' +
        'event: turn.created\n' +
        'data: {"id":1000,"campaignId":"11111111-1111-4111-8111-111111111111",' +
        '"payload":{"type":"turn.created","branchId":"22222222-2222-4222-8222-222222222222",' +
        '"turnId":"33333333-3333-4333-8333-333333333333"}}\n' +
        '\n',
    );
  });

  it('ARCH-090: narration with line breaks stays on one data line and parses back unchanged', () => {
    const bus = createEventBus({ firstId: 1_000 });
    const text = 'The door creaks open.\n\n"Who goes there?"\r\nSilence.';
    const event = bus.publish(campaignId, { type: 'narration.delta', turnId, offset: 12, text });
    const frame = formatEvent(event);

    expect(frame).toBe(
      'id: 1000\n' +
        'event: narration.delta\n' +
        'data: {"id":1000,"campaignId":"11111111-1111-4111-8111-111111111111",' +
        '"payload":{"type":"narration.delta","turnId":"33333333-3333-4333-8333-333333333333",' +
        '"offset":12,"text":"The door creaks open.\\n\\n\\"Who goes there?\\"\\r\\nSilence."}}\n' +
        '\n',
    );
    expect(frame).not.toContain('\r');
    const lines = frame.split('\n');
    expect(lines).toHaveLength(5);
    const data = lines[2]?.slice('data: '.length) ?? '';
    expect(ServerEventSchema.parse(JSON.parse(data))).toEqual(event);
  });
});

describe('formatPosition', () => {
  it('ARCH-091: a position frame has an ID and no data, so it fires no event', () => {
    expect(formatPosition(1_234)).toBe('id: 1234\n\n');
  });
});

describe('parseLastEventId', () => {
  it('ARCH-091: reads a decimal ID; missing is null, and anything else is never covered', () => {
    expect(parseLastEventId(undefined)).toBeNull();
    expect(parseLastEventId('')).toBeNull();
    expect(parseLastEventId('1730000000000')).toBe(1_730_000_000_000);
    expect(parseLastEventId('0')).toBe(0);
    for (const unreadable of ['abc', ' 12', '12.5', '-3', '1e3', '99999999999999999999']) {
      expect(parseLastEventId(unreadable)).toBe(-1);
    }
    expect(parseLastEventId(['1000', '1001'])).toBe(-1);
  });
});

describe('keep-alive', () => {
  it('CON-114: the keep-alive is one comment line, sent after 15 seconds idle', () => {
    expect(KEEP_ALIVE_COMMENT).toBe(': keep-alive\n\n');
    expect(KEEP_ALIVE_INTERVAL_MS).toBe(15_000);
  });
});

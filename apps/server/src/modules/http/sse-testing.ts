// Helpers for the http module's tests only, not exported from index.ts: an event stream
// read frame by frame as it arrives, as the browser's EventSource would.
import type { Readable } from 'node:stream';
import { type ServerEvent, ServerEventSchema } from '@mythos/contracts';

/** One frame of an event stream: its `id`, `event`, and `data` lines, and any comment. */
export type Frame = {
  id: string | null;
  event: string | null;
  data: string | null;
  comment: string | null;
};

function parseFrame(text: string): Frame {
  const frame: Frame = { id: null, event: null, data: null, comment: null };
  for (const line of text.split('\n')) {
    if (line.startsWith(':')) frame.comment = line.slice(1).trim();
    else if (line.startsWith('id: ')) frame.id = line.slice(4);
    else if (line.startsWith('event: ')) frame.event = line.slice(7);
    else if (line.startsWith('data: ')) frame.data = line.slice(6);
  }
  return frame;
}

/**
 * Reads an event stream as it arrives. `frames` holds every whole frame so far;
 * `waitFor` resolves with the first event, among all read so far or still to come, that
 * matches, and rejects if the stream ends first.
 */
export function frameReader(stream: Readable) {
  const frames: Frame[] = [];
  let buffer = '';
  let ended = false;
  const wake: (() => void)[] = [];
  const notify = () => {
    for (const resolve of wake.splice(0)) resolve();
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      frames.push(parseFrame(buffer.slice(0, end)));
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
    }
    notify();
  });
  stream.on('end', () => {
    ended = true;
    notify();
  });

  const events = (): ServerEvent[] =>
    frames.flatMap((frame) =>
      frame.data === null ? [] : [ServerEventSchema.parse(JSON.parse(frame.data))],
    );

  return {
    frames,
    events,
    ended: () => ended,
    async waitFor(matches: (event: ServerEvent) => boolean): Promise<ServerEvent> {
      for (;;) {
        const found = events().find(matches);
        if (found !== undefined) return found;
        if (ended) throw new Error('the event stream ended first');
        await new Promise<void>((resolve) => wake.push(resolve));
      }
    },
  };
}

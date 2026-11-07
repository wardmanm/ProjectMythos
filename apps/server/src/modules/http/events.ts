// A campaign's event stream (03-contracts §14.2): Server-Sent Events from the bus, with
// replay from `Last-Event-ID` (ARCH-091) and an idle keep-alive (CON-114). The steps are
// the events README's "Streaming a campaign".
import { PassThrough } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  formatEvent,
  formatPosition,
  KEEP_ALIVE_COMMENT,
  KEEP_ALIVE_INTERVAL_MS,
  parseLastEventId,
} from '../events';
import type { SetTimer } from '../providers';
import type { HttpDeps } from './deps';
import { parseParams, sendError } from './errors';
import { CampaignParamsSchema } from './params';

/**
 * A stream holding more than this many bytes its client has not taken is closed. The
 * browser reconnects with its last event ID and is replayed from the bus, or told to
 * resync (01-architecture Decisions).
 */
export const MAX_UNSENT_BYTES = 1024 * 1024;

type FrameWriter = {
  /** Writes a frame, unless the stream is closed, and re-arms the keep-alive. */
  write: (text: string) => void;
  /** Ends the stream once; `onClose` runs then. */
  close: () => void;
  readonly state: { closed: boolean; wrote: boolean };
};

/**
 * Writes one client's frames to `stream`. After each, the keep-alive waits 15 seconds
 * again (CON-114). A client too far behind is closed. Runs inside the bus's publish, so
 * it never throws or publishes (events README).
 */
function frameWriter(
  stream: PassThrough,
  reply: FastifyReply,
  setTimer: SetTimer,
  onClose: () => void,
): FrameWriter {
  const state = { closed: false, wrote: false };
  let cancelKeepAlive = (): void => undefined;
  const unsent = () => stream.writableLength + stream.readableLength + reply.raw.writableLength;

  function close(): void {
    if (state.closed) return;
    state.closed = true;
    cancelKeepAlive();
    onClose();
    stream.end();
  }

  function write(text: string): void {
    if (state.closed) return;
    stream.write(text);
    state.wrote = true;
    if (unsent() > MAX_UNSENT_BYTES) {
      reply.log.warn(
        { unsentBytes: unsent() },
        'an event stream fell too far behind, so it was closed',
      );
      close();
      return;
    }
    cancelKeepAlive();
    cancelKeepAlive = setTimer(KEEP_ALIVE_INTERVAL_MS, () => {
      write(KEEP_ALIVE_COMMENT);
    });
  }

  return { write, close, state };
}

/**
 * `GET /api/campaigns/:campaignId/events`. The body is a `PassThrough`, so Fastify sends
 * the headers, the session cookie among them, and frames written before it starts
 * piping wait in the stream in order. At shutdown every open stream is ended first, so
 * the server can close. Implements ARCH-091 and CON-114.
 */
export function installEventRoutes(fastify: FastifyInstance, deps: HttpDeps): void {
  const openStreams = new Set<() => void>();

  fastify.get('/api/campaigns/:campaignId/events', (request, reply) => {
    const params = parseParams(CampaignParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const { campaignId } = params.value;
    const opened = deps.turn.store.openCampaign(campaignId);
    if (!opened.ok) return sendError(reply, opened.error);

    const stream = new PassThrough();
    let unsubscribe: (() => void) | null = null;
    const writer = frameWriter(stream, reply, deps.setTimer, () => {
      openStreams.delete(writer.close);
      unsubscribe?.();
    });

    const lastEventId = parseLastEventId(request.headers['last-event-id']);
    // A new stream starts at the bus's position, so a client that drops before its first
    // event reconnects with an ID the buffer covers (01-architecture Decisions).
    if (lastEventId === null) writer.write(formatPosition(deps.bus.lastId()));
    unsubscribe = deps.bus.subscribe(campaignId, lastEventId, (event) => {
      writer.write(formatEvent(event));
    });
    if (writer.state.closed) {
      // The replay closed the stream before `unsubscribe` was set.
      unsubscribe();
    } else {
      // With nothing to replay, the keep-alive goes at once, so the headers are sent and
      // the browser's `open` fires now rather than 15 seconds from now.
      if (!writer.state.wrote) writer.write(KEEP_ALIVE_COMMENT);
      openStreams.add(writer.close);
    }
    reply.raw.on('close', writer.close);

    return reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(stream);
  });

  fastify.addHook('preClose', (done) => {
    for (const close of [...openStreams]) close();
    done();
  });
}

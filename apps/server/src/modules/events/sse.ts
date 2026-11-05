// The SSE wire format for the event stream (03-contracts §14.2). Frames end lines with
// a literal "\n", never `os.EOL`, so the bytes are the same on Windows and macOS.
import type { ServerEvent } from '@mythos/contracts';

/** A comment line, which `EventSource` ignores; it keeps an idle stream open (CON-114). */
export const KEEP_ALIVE_COMMENT = ': keep-alive\n\n';

/** How long a stream may be idle before it gets a keep-alive comment (CON-114). */
export const KEEP_ALIVE_INTERVAL_MS = 15_000;

/**
 * One event as one SSE frame: its ID, its payload type as the event name, and the
 * whole event as JSON on one `data` line. `JSON.stringify` escapes line breaks, so
 * narration text cannot split the frame. Implements ARCH-090.
 */
export function formatEvent(event: ServerEvent): string {
  return `id: ${String(event.id)}\nevent: ${event.payload.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * A frame with only an ID: it sets the browser's last event ID without firing an event,
 * so a stream that drops before its first event still resumes from here (ARCH-091).
 */
export function formatPosition(id: number): string {
  return `id: ${String(id)}\n\n`;
}

/**
 * Reads the `Last-Event-ID` request header. Missing or empty gives null (replay
 * nothing). A decimal safe integer gives that number. Anything else gives -1, which no
 * buffer covers, so that client is told to resync (ARCH-091).
 */
export function parseLastEventId(header: string | string[] | undefined): number | null {
  if (header === undefined || header === '') return null;
  if (typeof header !== 'string' || !/^[0-9]+$/.test(header)) return -1;
  const id = Number(header);
  return Number.isSafeInteger(id) ? id : -1;
}

// Reads a streamed response body as it arrives (PRV-045): line by line for
// newline-delimited JSON (Ollama), or event by event for server-sent events
// (OpenAI-compatible servers, Anthropic). Each reader pulls one chunk at a time, so a line
// or event is yielded as soon as its last byte arrives, and a line split across chunks,
// even inside a UTF-8 character, is put back together.
//
// The body comes in as `Result`s, as http.ts's `chunks()` yields it. A failure is passed
// on as it is and ends the reader. Stopping early, or reaching `[DONE]`, stops the body
// too, which closes the connection.
import { ok, type Result } from '@mythos/contracts';

/** One server-sent event: its `event:` name (`message` when it has none) and its data. */
export type SseEvent = { event: string; data: string };

/**
 * Each line of a body, without its line ending (`\n` or `\r\n`). A last line with no line
 * ending is still yielded.
 */
async function* readLines<E>(
  chunks: AsyncIterable<Result<Uint8Array, E>>,
): AsyncGenerator<Result<string, E>, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of chunks) {
    if (!chunk.ok) {
      yield chunk;
      return;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    let start = 0;
    let end = buffer.indexOf('\n', start);
    while (end !== -1) {
      yield ok(withoutCr(buffer.slice(start, end)));
      start = end + 1;
      end = buffer.indexOf('\n', start);
    }
    buffer = buffer.slice(start);
  }
  buffer += decoder.decode();
  if (buffer !== '') yield ok(withoutCr(buffer));
}

function withoutCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Each non-blank line of a newline-delimited JSON body, for the adapter to parse with
 * its wire schema. Implements PRV-045.
 */
export async function* readNdjsonLines<E>(
  chunks: AsyncIterable<Result<Uint8Array, E>>,
): AsyncGenerator<Result<string, E>, void, undefined> {
  for await (const line of readLines(chunks)) {
    if (!line.ok) {
      yield line;
      return;
    }
    if (line.value.trim() !== '') yield line;
  }
}

/** The data that ends an OpenAI-style stream. */
const DONE = '[DONE]';

/**
 * Each event of a server-sent-events body, by the WHATWG rules: `event:` names the event,
 * each `data:` line adds a line to its data, a blank line ends it, and lines starting
 * with `:` are comments. `id:`, `retry:`, and unknown fields are ignored, and an event
 * whose data is empty is skipped. An event whose data is `[DONE]` ends the stream and is
 * not yielded. Unlike the WHATWG rules, an event cut off by the end of the body is still
 * yielded, so the adapter sees what arrived. Implements PRV-045.
 */
export async function* readSseEvents<E>(
  chunks: AsyncIterable<Result<Uint8Array, E>>,
): AsyncGenerator<Result<SseEvent, E>, void, undefined> {
  let event = '';
  let data: string[] = [];
  for await (const line of readLines(chunks)) {
    if (!line.ok) {
      yield line;
      return;
    }
    if (line.value === '') {
      const complete = finish(event, data);
      if (complete?.data === DONE) return;
      if (complete !== null) yield ok(complete);
      event = '';
      data = [];
      continue;
    }
    const field = parseField(line.value);
    if (field?.name === 'event') event = field.value;
    if (field?.name === 'data') data.push(field.value);
  }
  const last = finish(event, data);
  if (last !== null && last.data !== DONE) yield ok(last);
}

/** The event made of what was read since the last blank line, or null if it has no data. */
function finish(event: string, data: readonly string[]): SseEvent | null {
  const joined = data.join('\n');
  if (joined === '') return null;
  return { event: event === '' ? 'message' : event, data: joined };
}

/**
 * A line's field name and value: `name: value` (one space after the colon is dropped),
 * or a bare `name` with an empty value. Null for a comment.
 */
function parseField(line: string): { name: string; value: string } | null {
  if (line.startsWith(':')) return null;
  const colon = line.indexOf(':');
  if (colon === -1) return { name: line, value: '' };
  const value = line.slice(colon + 1);
  return { name: line.slice(0, colon), value: value.startsWith(' ') ? value.slice(1) : value };
}

import { err, ok, type Result } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { readNdjsonLines, readSseEvents, type SseEvent } from './lines';

const encoder = new TextEncoder();

/**
 * A body that yields each piece as one chunk, then `failure` if given, and records what
 * was pulled and whether it was stopped early, so a test can see the reader's pace.
 */
function body(pieces: readonly (string | Uint8Array)[], failure?: string) {
  const log: string[] = [];
  async function* chunks(): AsyncGenerator<Result<Uint8Array, string>, void, undefined> {
    try {
      for (const [index, piece] of pieces.entries()) {
        log.push(`chunk ${String(index)}`);
        await Promise.resolve();
        yield ok(typeof piece === 'string' ? encoder.encode(piece) : piece);
      }
      if (failure !== undefined) yield err(failure);
      log.push('end');
    } finally {
      log.push('closed');
    }
  }
  return { chunks: chunks(), log };
}

async function collect<T>(
  reader: AsyncIterable<Result<T, string>>,
  log?: string[],
): Promise<Result<T, string>[]> {
  const items: Result<T, string>[] = [];
  for await (const item of reader) {
    log?.push('item');
    items.push(item);
  }
  return items;
}

const events = (...list: SseEvent[]): Result<SseEvent, string>[] => list.map((event) => ok(event));

describe('readNdjsonLines', () => {
  it('PRV-045: yields each line as soon as it is complete, across chunk boundaries', async () => {
    const { chunks, log } = body(['{"a":1}\n{"b"', ':2}\n', '{"c":3}\n']);
    expect(await collect(readNdjsonLines(chunks), log)).toEqual([
      ok('{"a":1}'),
      ok('{"b":2}'),
      ok('{"c":3}'),
    ]);
    expect(log).toEqual(['chunk 0', 'item', 'chunk 1', 'item', 'chunk 2', 'item', 'end', 'closed']);
  });

  it('PRV-045: skips blank lines, strips CRLF, and keeps a last line with no newline', async () => {
    const { chunks } = body(['{"a":1}\r\n\r\n', '  \n{"b":2}']);
    expect(await collect(readNdjsonLines(chunks))).toEqual([ok('{"a":1}'), ok('{"b":2}')]);
  });

  it('PRV-045: a UTF-8 character split across chunks is put back together', async () => {
    const bytes = encoder.encode('{"text":"café"}\n');
    const { chunks } = body([bytes.slice(0, 13), bytes.slice(13)]);
    expect(await collect(readNdjsonLines(chunks))).toEqual([ok('{"text":"café"}')]);
  });

  it('PRV-045: a failure in the body is passed on and ends the lines', async () => {
    const { chunks, log } = body(['{"a":1}\n{"b"'], 'dropped');
    expect(await collect(readNdjsonLines(chunks))).toEqual([ok('{"a":1}'), err('dropped')]);
    expect(log).toEqual(['chunk 0', 'closed']);
  });
});

describe('readSseEvents', () => {
  it('PRV-045: yields data-only events as "message", each as soon as it is complete', async () => {
    const { chunks, log } = body(['data: {"a":1}\n\n', 'data: {"b":2}\n\n']);
    expect(await collect(readSseEvents(chunks), log)).toEqual(
      events({ event: 'message', data: '{"a":1}' }, { event: 'message', data: '{"b":2}' }),
    );
    expect(log).toEqual(['chunk 0', 'item', 'chunk 1', 'item', 'end', 'closed']);
  });

  it('PRV-045: reads event names, joins data lines, and skips comments, other fields, and empty events', async () => {
    const text =
      ': keep-alive\n' +
      'event: content_block_delta\nid: 7\nretry: 1000\ndata: {"x":\ndata:1}\n\n' +
      'event: ping\n\n' +
      'data\n\n' +
      'data:{"y":2}\n\n';
    const { chunks } = body([text]);
    expect(await collect(readSseEvents(chunks))).toEqual(
      events(
        { event: 'content_block_delta', data: '{"x":\n1}' },
        { event: 'message', data: '{"y":2}' },
      ),
    );
  });

  it('PRV-045: handles CRLF line endings', async () => {
    const { chunks } = body(['event: delta\r\ndata: one\r\n\r\ndata: two\r\n\r\n']);
    expect(await collect(readSseEvents(chunks))).toEqual(
      events({ event: 'delta', data: 'one' }, { event: 'message', data: 'two' }),
    );
  });

  it('PRV-045: an event split across chunks at any point is read the same', async () => {
    const text = 'event: delta\r\ndata: {"text":"Hi"}\r\n\r\ndata: [DONE]\r\n\r\n';
    for (let at = 1; at < text.length; at += 1) {
      const { chunks } = body([text.slice(0, at), text.slice(at)]);
      expect(await collect(readSseEvents(chunks))).toEqual(
        events({ event: 'delta', data: '{"text":"Hi"}' }),
      );
    }
  });

  it('PRV-045: [DONE] ends the stream, unread chunks and all, and closes the body', async () => {
    const { chunks, log } = body(['data: {"a":1}\n\ndata: [DONE]\n\n', 'data: {"late":1}\n\n']);
    expect(await collect(readSseEvents(chunks))).toEqual(
      events({ event: 'message', data: '{"a":1}' }),
    );
    expect(log).toEqual(['chunk 0', 'closed']);
  });

  it('PRV-045: an event cut off by the end of the body is still yielded', async () => {
    const { chunks } = body(['data: {"a":1}\n\ndata: {"b":2}']);
    expect(await collect(readSseEvents(chunks))).toEqual(
      events({ event: 'message', data: '{"a":1}' }, { event: 'message', data: '{"b":2}' }),
    );
  });

  it('PRV-045: a failure in the body is passed on and ends the events', async () => {
    const { chunks } = body(['data: {"a":1}\n\ndata: {"b"'], 'timed out');
    expect(await collect(readSseEvents(chunks))).toEqual([
      ok({ event: 'message', data: '{"a":1}' }),
      err('timed out'),
    ]);
  });

  it('PRV-045: stopping early closes the body', async () => {
    const { chunks, log } = body(['data: 1\n\n', 'data: 2\n\n', 'data: 3\n\n']);
    for await (const event of readSseEvents(chunks)) {
      expect(event).toEqual(ok({ event: 'message', data: '1' }));
      break;
    }
    expect(log).toEqual(['chunk 0', 'closed']);
  });
});

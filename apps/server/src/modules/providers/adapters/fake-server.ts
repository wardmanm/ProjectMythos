// A fake provider for adapter tests: a `node:http` server on 127.0.0.1 and a random port,
// so no test touches the network or a real model (CONV-113). A test scripts each reply,
// then reads back every request the adapter sent. Test-only, and not exported from
// index.ts.
import http from 'node:http';

/** One request the server received. */
export type FakeRequest = {
  method: string;
  /** The path, with any query string: `/api/chat`. */
  path: string;
  /** Node's lowercase header names. */
  headers: http.IncomingHttpHeaders;
  /** The body parsed as JSON; the raw text if it is not JSON; null if there is none. */
  body: unknown;
};

/** One piece of a streamed body: text written at once, or after a pause. */
export type FakeChunk = string | { delayMs: number; text: string };

/** One scripted reply. `status` defaults to 200. */
export type FakeReply =
  | { type: 'json'; status?: number; headers?: Record<string, string>; body: unknown }
  | { type: 'text'; status?: number; headers?: Record<string, string>; body: string }
  | {
      type: 'stream';
      status?: number;
      headers?: Record<string, string>;
      /** Written in order, each as its own write, after the headers are sent. */
      chunks: readonly FakeChunk[];
      /** After the last chunk: end the body (the default), stall, or drop the connection. */
      after?: 'end' | 'hang' | 'destroy';
    }
  /** Never answers, not even with headers. */
  | { type: 'hang' }
  /** Drops the connection without answering. */
  | { type: 'destroy' };

export type FakeServer = {
  /** `http://127.0.0.1:<port>`, with no trailing slash. */
  readonly baseUrl: string;
  /** Every request received, in order. */
  readonly requests: readonly FakeRequest[];
  /**
   * Queues replies for `method` and `path` (without a query string); each request takes
   * the next one. A request with none queued gets a 501 whose error names it.
   */
  reply: (method: string, path: string, ...replies: FakeReply[]) => void;
  /** Drops every open connection, then stops the server. */
  close: () => Promise<void>;
};

/** Starts a fake server on 127.0.0.1 and a port the OS picks. */
export async function startFakeServer(): Promise<FakeServer> {
  const queues = new Map<string, FakeReply[]>();
  const requests: FakeRequest[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;

  function pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, ms);
      timers.add(timer);
    });
  }

  const server = http.createServer((req, res) => {
    void readBody(req).then(async (text) => {
      const path = req.url ?? '/';
      requests.push({ method: req.method ?? '', path, headers: req.headers, body: parse(text) });
      const key = routeKey(req.method ?? '', path.split('?')[0] ?? path);
      const reply = queues.get(key)?.shift() ?? unscripted(key);
      await send(reply, req, res, pause);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The fake server has no port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests,
    reply: (method, path, ...replies) => {
      const key = routeKey(method, path);
      queues.set(key, [...(queues.get(key) ?? []), ...replies]);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function unscripted(key: string): FakeReply {
  return {
    type: 'json',
    status: 501,
    body: { error: `The fake server has no reply scripted for ${key}.` },
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    req.on('data', (part: Buffer) => {
      parts.push(part);
    });
    req.on('end', () => {
      resolve(Buffer.concat(parts).toString('utf8'));
    });
  });
}

function parse(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: the test sees the raw text instead (CONV-043).
    return text;
  }
}

async function send(
  reply: FakeReply,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pause: (ms: number) => Promise<void>,
): Promise<void> {
  switch (reply.type) {
    case 'hang':
      return;
    case 'destroy':
      req.socket.destroy();
      return;
    case 'json':
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
      res.end(JSON.stringify(reply.body));
      return;
    case 'text':
      res.writeHead(reply.status ?? 200, { 'content-type': 'text/plain', ...reply.headers });
      res.end(reply.body);
      return;
    case 'stream':
      res.writeHead(reply.status ?? 200, reply.headers);
      res.flushHeaders();
      for (const chunk of reply.chunks) {
        if (typeof chunk !== 'string') await pause(chunk.delayMs);
        if (res.destroyed) return;
        await write(res, typeof chunk === 'string' ? chunk : chunk.text);
      }
      if (reply.after === 'destroy') req.socket.destroy();
      else if (reply.after !== 'hang') res.end();
      return;
  }
}

/** Writes `text` and waits until it has gone, so a drop that follows cannot lose it. */
function write(res: http.ServerResponse, text: string): Promise<void> {
  return new Promise((resolve) => {
    res.write(text, () => {
      resolve();
    });
  });
}

/** One line of a newline-delimited JSON body. */
export function ndjsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/**
 * One server-sent event: an `event:` line when `event` is given, a `data:` line, and the
 * blank line that ends it. Data that is not a string is sent as JSON.
 */
export function sseEvent(data: unknown, event?: string): string {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return `${event === undefined ? '' : `event: ${event}\n`}data: ${text}\n\n`;
}

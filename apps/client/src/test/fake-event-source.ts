// A stand-in for the browser's EventSource. Tests open, feed, drop, and fail streams by hand.
import type { ServerEvent } from '@mythos/contracts';
import { vi } from 'vitest';

/** Implements the parts of EventSource the client uses, plus controls for tests. */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  /** Every stream opened since the test began, oldest first. */
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;

  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** The connection opens. */
  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  /** The server sends an event as P1-T09 frames it: named by its payload type. */
  send(event: ServerEvent): void {
    this.sendRaw(event.payload.type, JSON.stringify(event), String(event.id));
  }

  /** The server sends a frame with any name and data. */
  sendRaw(type: string, data: string, lastEventId = ''): void {
    this.dispatchEvent(new MessageEvent(type, { data, lastEventId }));
  }

  /** The connection drops and the browser will reconnect by itself. */
  drop(): void {
    this.readyState = FakeEventSource.CONNECTING;
    this.dispatchEvent(new Event('error'));
  }

  /** The browser gives up, as after an error status: it will not reconnect. */
  fail(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.dispatchEvent(new Event('error'));
  }
}

/** Installs the fake as the global EventSource. The test setup calls it before each test. */
export function installFakeEventSource(): void {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
}

/** The most recently opened stream; fails the test if none is open. */
export function latestEventSource(): FakeEventSource {
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) throw new Error('no EventSource was opened');
  return source;
}

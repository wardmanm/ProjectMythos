// The events module's public API (ARCH-020): the event bus and the SSE wire format. It
// imports no other module (ARCH-021).
export {
  REPLAY_BUFFER_SIZE,
  createEventBus,
  type EventBus,
  type EventBusOptions,
  type SendEvent,
} from './bus';
export {
  KEEP_ALIVE_COMMENT,
  KEEP_ALIVE_INTERVAL_MS,
  formatEvent,
  formatPosition,
  parseLastEventId,
} from './sse';

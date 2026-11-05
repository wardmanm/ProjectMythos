// Runs before each client test file (vite.config.ts). Every test starts with fakes for the
// browser APIs the client uses, so none touches the network (CONV-113), and ends with the
// DOM, the globals, and the UI store as they were.
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { useNoticeStore } from '@/stores/notice-store';
import { installFakeEventSource } from './fake-event-source';
import { installFakeFetch } from './fake-fetch';
import { installFakeMatchMedia } from './fake-match-media';

// jsdom lacks these, and Radix's menus call them.
class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Element.prototype.scrollIntoView = () => undefined;
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => undefined;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoResizeObserver);
  installFakeMatchMedia();
  installFakeEventSource();
  installFakeFetch();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useNoticeStore.setState({ notice: null });
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('class');
});

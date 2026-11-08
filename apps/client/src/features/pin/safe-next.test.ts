import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('ARCH-110: an address within the app is kept, with its query and hash', () => {
    expect(safeNext('/settings')).toBe('/settings');
    expect(safeNext('/c/abc/inspector/t1?tab=output#tier-2')).toBe(
      '/c/abc/inspector/t1?tab=output#tier-2',
    );
    expect(safeNext('/')).toBe('/');
  });

  it('ARCH-110: an address that would leave the app goes to the library instead', () => {
    for (const unsafe of [
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      'https://evil.example/',
      'javascript:alert(1)',
      'settings',
      '',
    ]) {
      expect(safeNext(unsafe), JSON.stringify(unsafe)).toBe('/');
    }
    expect(safeNext(null)).toBe('/');
  });

  it('ARCH-110: the PIN screen is never where it returns to', () => {
    expect(safeNext('/pin')).toBe('/');
    expect(safeNext('/pin/?next=/pin')).toBe('/');
  });
});

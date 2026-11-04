import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultDataDir, resolveConfigDir, resolveDataDir } from './data-dir';

describe('defaultDataDir', () => {
  it('ARCH-030: Windows uses %APPDATA%\\Mythos', () => {
    const env = { APPDATA: 'C:\\Users\\mike\\AppData\\Roaming' };
    expect(defaultDataDir('win32', env, 'C:\\Users\\mike')).toBe(
      'C:\\Users\\mike\\AppData\\Roaming\\Mythos',
    );
  });

  it('ARCH-030: Windows falls back to the roaming folder in home when APPDATA is unset', () => {
    expect(defaultDataDir('win32', {}, 'C:\\Users\\mike')).toBe(
      'C:\\Users\\mike\\AppData\\Roaming\\Mythos',
    );
  });

  it('ARCH-030: macOS uses ~/Library/Application Support/Mythos', () => {
    expect(defaultDataDir('darwin', {}, '/Users/mike')).toBe(
      '/Users/mike/Library/Application Support/Mythos',
    );
  });

  it('ARCH-030: Linux uses $XDG_DATA_HOME/mythos', () => {
    expect(defaultDataDir('linux', { XDG_DATA_HOME: '/data' }, '/home/mike')).toBe('/data/mythos');
  });

  it('ARCH-030: Linux falls back to ~/.local/share/mythos', () => {
    expect(defaultDataDir('linux', { XDG_DATA_HOME: '' }, '/home/mike')).toBe(
      '/home/mike/.local/share/mythos',
    );
  });
});

describe('resolveDataDir and resolveConfigDir', () => {
  const cwd = path.resolve('work');
  const configDir = path.resolve('config');
  const osDefault = path.resolve('os-default');

  it('ARCH-030: the --data-dir flag wins over machine config and the OS default', () => {
    expect(resolveDataDir({ flag: 'flagged', configured: 'set', configDir, cwd, osDefault })).toBe(
      path.join(cwd, 'flagged'),
    );
    expect(resolveConfigDir({ flag: 'flagged', cwd, osDefault })).toBe(path.join(cwd, 'flagged'));
  });

  it('ARCH-030: machine config wins over the OS default, read from the config folder', () => {
    expect(resolveDataDir({ flag: null, configured: 'set', configDir, cwd, osDefault })).toBe(
      path.join(configDir, 'set'),
    );
  });

  it('ARCH-030: with neither, the OS default holds the data and the config', () => {
    expect(resolveDataDir({ flag: null, configured: null, configDir, cwd, osDefault })).toBe(
      osDefault,
    );
    expect(resolveConfigDir({ flag: null, cwd, osDefault })).toBe(osDefault);
  });
});

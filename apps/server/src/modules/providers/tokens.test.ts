import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type ModelProfile, ModelProfileSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { CALIBRATION_FILE, estimateTokens, openCalibration } from './tokens';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function emptyDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mythos-tokens-'));
  tempDirs.push(dir);
  return dir;
}

const profile: ModelProfile = ModelProfileSchema.parse({
  id: 'qwen-local',
  providerId: 'ollama-local',
  model: 'qwen3.6:35b-a3b',
  kind: 'text',
  contextWindow: 32768,
  maxOutputTokens: 2048,
  structuredOutput: 'json-schema',
});

/** A prompt whose provider reports exactly `prompt.length / trueRatio` tokens. */
const prompt = 'x'.repeat(9000);
const trueRatio = 4.5;
const reported = prompt.length / trueRatio;

describe('estimateTokens', () => {
  it('PRV-070: tokens are characters divided by the ratio, rounded up', () => {
    expect(estimateTokens('', 3.5)).toBe(0);
    expect(estimateTokens('abcdefgh', 4)).toBe(2);
    expect(estimateTokens('abcdefghi', 4)).toBe(3);
    expect(estimateTokens('abcdefgh', 3.5)).toBe(3);
  });
});

describe('calibration', () => {
  it('PRV-071: converges toward a constant ratio within ten calls', async () => {
    const { calibration } = await openCalibration(emptyDir());
    expect(calibration.charsPerToken(profile)).toBe(3.5);
    for (let call = 0; call < 10; call += 1) {
      const estimated = estimateTokens(prompt, calibration.charsPerToken(profile));
      await calibration.calibrate(profile, estimated, reported);
    }
    expect(Math.abs(calibration.charsPerToken(profile) - trueRatio)).toBeLessThan(0.15);
  });

  it('PRV-071: survives a reload', async () => {
    const dir = emptyDir();
    const first = await openCalibration(dir);
    await first.calibration.calibrate(profile, estimateTokens(prompt, 3.5), reported);
    const ratio = first.calibration.charsPerToken(profile);
    expect(ratio).toBeCloseTo(3.7, 3);

    const reopened = await openCalibration(dir);
    expect(reopened.problem).toBeNull();
    expect(reopened.calibration.charsPerToken(profile)).toBe(ratio);
  });

  it('PRV-071: is saved in calibration.json and leaves machine-config.json untouched', async () => {
    const dir = emptyDir();
    const configText = '{ "schemaVersion": 1 }\n';
    writeFileSync(path.join(dir, 'machine-config.json'), configText);
    const { calibration } = await openCalibration(dir);
    await calibration.calibrate(profile, 2000, 2000);

    expect(readFileSync(path.join(dir, 'machine-config.json'), 'utf8')).toBe(configText);
    expect(JSON.parse(readFileSync(path.join(dir, CALIBRATION_FILE), 'utf8'))).toEqual({
      schemaVersion: 1,
      profiles: { 'qwen-local:qwen3.6:35b-a3b': { charsPerToken: 3.5, samples: 1 } },
    });
  });

  it('PRV-071: a profile uses its own ratio until it is calibrated', async () => {
    const { calibration } = await openCalibration(emptyDir());
    const other = { ...profile, id: 'other', charsPerToken: 3.1 };
    await calibration.calibrate(profile, 2000, 1000);
    expect(calibration.charsPerToken(other)).toBe(3.1);
    expect(calibration.charsPerToken(profile)).not.toBe(3.5);
  });

  it("PRV-071: changing a profile's model starts again from the profile's ratio", async () => {
    const { calibration } = await openCalibration(emptyDir());
    await calibration.calibrate(profile, 2000, 1000);
    const newModel = { ...profile, model: 'gemma4:27b' };
    expect(calibration.charsPerToken(newModel)).toBe(3.5);
    expect(calibration.charsPerToken(profile)).toBeCloseTo(4.2, 10);
  });

  it('PRV-071: a call with zero tokens on either side changes nothing', async () => {
    const dir = emptyDir();
    const { calibration } = await openCalibration(dir);
    await calibration.calibrate(profile, 0, 120);
    await calibration.calibrate(profile, 120, 0);
    expect(calibration.charsPerToken(profile)).toBe(3.5);
    expect(() => readFileSync(path.join(dir, CALIBRATION_FILE))).toThrow();
  });

  it('PRV-071: calibrations made at once are all saved, in order', async () => {
    const dir = emptyDir();
    const { calibration } = await openCalibration(dir);
    await Promise.all(
      [1000, 1100, 1200, 1300, 1400].map((count) => calibration.calibrate(profile, 2000, count)),
    );
    const reopened = await openCalibration(dir);
    expect(reopened.calibration.charsPerToken(profile)).toBe(calibration.charsPerToken(profile));
    const saved: unknown = JSON.parse(readFileSync(path.join(dir, CALIBRATION_FILE), 'utf8'));
    expect(saved).toMatchObject({ profiles: { 'qwen-local:qwen3.6:35b-a3b': { samples: 5 } } });
  });

  it('PRV-071: a corrupt file starts empty and says why', async () => {
    const dir = emptyDir();
    writeFileSync(path.join(dir, CALIBRATION_FILE), '{ "schemaVersion": 2, "profiles": {} }\n');
    const { calibration, problem } = await openCalibration(dir);
    expect(problem).toContain(CALIBRATION_FILE);
    expect(problem).toContain('schemaVersion');
    expect(calibration.charsPerToken(profile)).toBe(3.5);

    writeFileSync(path.join(dir, CALIBRATION_FILE), 'not json');
    expect((await openCalibration(dir)).problem).toContain('not valid JSON');
  });
});

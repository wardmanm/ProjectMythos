import { describe, expect, it } from 'vitest';
import { brokenPack, referencePack, saltmarshPack } from '@/features/library/testing';
import {
  commandFor,
  defaultPackId,
  premadeScenarios,
  startablePacks,
  suggestedName,
} from './choices';

describe('new-campaign choices', () => {
  it('SCH-102: a pack with any issue is not startable', () => {
    const packs = [brokenPack(), saltmarshPack(), referencePack()];
    expect(startablePacks(packs).map((pack) => pack.packId)).toEqual(['saltmarsh', 'reference']);
  });

  it('UI-123: the reference pack is the default when it can start, else the first pack', () => {
    expect(defaultPackId([saltmarshPack(), referencePack()])).toBe('reference');
    expect(defaultPackId([saltmarshPack()])).toBe('saltmarsh');
    expect(defaultPackId([])).toBeNull();
  });

  it('SCH-110: only scenarios with a premade PC are offered in phase 1', () => {
    expect(premadeScenarios(saltmarshPack()).map((scenario) => scenario.id)).toEqual([
      'scenario.low-tide',
    ]);
  });

  it("SCH-110: the command takes the setting's tone profile and ruleset, and the premade PC", () => {
    const pack = saltmarshPack();
    const [scenario] = premadeScenarios(pack);
    expect(commandFor('  Low Tide  ', pack, scenario!)).toEqual({
      name: 'Low Tide',
      packId: 'saltmarsh',
      scenarioId: 'scenario.low-tide',
      toneProfileId: 'tone.adventure',
      rulesetId: 'ruleset.d20',
      conversion: null,
      pc: { mode: 'premade' },
    });
    const toneless = saltmarshPack({ defaults: { toneProfileId: null, rulesetId: 'ruleset.d20' } });
    expect(commandFor('Low Tide', toneless, scenario!)).toBeNull();
  });

  it("SCH-110: the suggested name is the setting and scenario, cut to the command's 80 characters", () => {
    const pack = referencePack();
    const [scenario] = premadeScenarios(pack);
    expect(suggestedName(pack, scenario!)).toBe('Brinemoor: Arrival');
    const long = referencePack({ settingName: 'A'.repeat(100) });
    expect(suggestedName(long, scenario!)).toHaveLength(80);
  });
});
